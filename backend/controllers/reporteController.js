const ExcelJS = require('exceljs');
const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas, getUserAllowedLocations } = require('../middlewares/auth');
const { autocompletarAsistenciasPasadas } = require('../services/asistenciaService');

// Vista principal de reportes con filtros interactivos
async function showReportes(req, res) {
    const user = req.user || req.session.user;
    const pool = await getPool();

    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];
    const sieteDiasAtras = new Date();
    sieteDiasAtras.setDate(hoy.getDate() - 14);

    const tipoReporte = req.query.tipo || 'detalle_puesto'; // 'detalle_puesto', 'resumen_area', 'diario'
    const fechaInicio = req.query.fechaInicio || sieteDiasAtras.toISOString().split('T')[0];
    const fechaFin = req.query.fechaFin || hoy.toISOString().split('T')[0];
    const fechaDiario = req.query.fechaDiario || hoy.toISOString().split('T')[0];
    const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    const ubicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const puestoId = req.query.puestoId ? parseInt(req.query.puestoId, 10) : null;

    try {
        // Garantizar que fechas pasadas tengan autocompletados sus ceros
        if (tipoReporte === 'diario' && fechaDiario < hoyStr) {
            await autocompletarAsistenciasPasadas(fechaDiario, areaId);
        } else {
            autocompletarAsistenciasPasadas().catch(e => console.error('Report background autocomplete error:', e.message));
        }

        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const reportableAreas = allowedAreas.filter(a => a.permite_reportes == 1 || user.rol_codigo === 'ADMIN');
        const areaIds = reportableAreas.map(a => a.id_area);

        let data = [];
        let totales = { personas: 0, promedioDiario: 0, totalPuestos: 0, totalContratados: 0, faltantes: 0, porcentajeCobertura: 100 };
        let chartData = { labels: [], datasets: [] };
        let chartDataPuestos = { labels: [], datasets: [] };
        let ubicacionesFiltro = [];
        let puestosFiltro = [];

        // Paleta Oficial de Colores Corporativos para Gráficos
        const colorPalette = [
            '#860063', '#F88D2A', '#00A5B5', '#6DBA00', '#7373C0', '#D83548', '#B766A2', '#FBBB7F', '#61C5B8',
            '#2E7D32', '#1565C0', '#C2185B', '#E65100', '#00838F', '#4527A0', '#558B2F', '#4E342E'
        ];

        if (areaIds.length > 0) {
            let filterAreas = areaId ? [areaId] : areaIds;
            if (areaId && !areaIds.includes(areaId)) {
                req.flash('error', 'No tienes permiso para ver reportes del área seleccionada.');
                return res.redirect('/reportes');
            }

            // Cargar ubicaciones y puestos para los filtros según el área
            if (areaId) {
                ubicacionesFiltro = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, areaId);
                const puestosRes = await pool.request()
                    .input('areaId', sql.Int, areaId)
                    .query('SELECT id_puesto, nombre FROM Puestos WHERE id_area = @areaId AND activo = 1 ORDER BY nombre ASC');
                puestosFiltro = puestosRes.recordset;
            } else {
                const areaListStrAll = areaIds.join(',');
                const puestosRes = await pool.request().query(
                    `SELECT id_puesto, nombre, id_area FROM Puestos WHERE id_area IN (${areaListStrAll}) AND activo = 1 ORDER BY nombre ASC`
                );
                puestosFiltro = puestosRes.recordset;
            }

            const areaListStr = filterAreas.join(',');

            if (tipoReporte === 'diario') {
                // Reporte específico de un día por puestos, áreas y ubicaciones
                let queryDiario = `
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        ub.id_ubicacion,
                        ub.nombre AS ubicacion_nombre,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                        ISNULL(p.aplica_turnos, 0) AS aplica_turnos,
                        ISNULL(ad.turno, 'UNICO') AS turno,
                        ISNULL(ad.cantidad_asistentes, 0) AS cantidad_asistentes,
                        ad.observaciones,
                        ad.fecha_registro,
                        FORMAT(ad.fecha_registro, 'hh:mm tt') AS hora_registro_texto,
                        FORMAT(ad.fecha_registro, 'dd/MM/yyyy hh:mm tt') AS fecha_registro_texto,
                        u.nombre AS registrado_por
                    FROM Puestos p
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    LEFT JOIN Asistencias_Diarias ad ON p.id_puesto = ad.id_puesto AND ad.fecha = @fecha
                    LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                    LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                    WHERE ar.id_area IN (${areaListStr}) AND p.activo = 1
                `;

                const reqDiario = pool.request().input('fecha', sql.Date, fechaDiario);

                if (ubicacionId) {
                    queryDiario += ` AND ad.id_ubicacion = @ubId`;
                    reqDiario.input('ubId', sql.Int, ubicacionId);
                }

                if (puestoId) {
                    queryDiario += ` AND p.id_puesto = @puestoId`;
                    reqDiario.input('puestoId', sql.Int, puestoId);
                }

                if (user.rol_codigo !== 'ADMIN') {
                    queryDiario += `
                        AND (
                            ad.id_ubicacion IS NULL 
                            OR ad.id_ubicacion IN (SELECT id_ubicacion FROM Usuario_Ubicaciones WHERE id_usuario = ${user.id_usuario})
                        )
                    `;
                }

                queryDiario += ` ORDER BY ar.nombre ASC, ub.nombre ASC, p.nombre ASC, ad.turno ASC`;

                const result = await reqDiario.query(queryDiario);
                data = result.recordset.map(item => {
                    const contratada = item.cantidad_contratada || 0;
                    const asistentes = item.cantidad_asistentes || 0;
                    const faltantes = contratada > 0 ? Math.max(0, contratada - asistentes) : 0;
                    const cobertura = contratada > 0 ? Math.round((asistentes / contratada) * 100) : (asistentes > 0 ? 100 : 0);
                    return {
                        ...item,
                        faltantes,
                        cobertura
                    };
                });

                totales.personas = data.reduce((sum, item) => sum + item.cantidad_asistentes, 0);
                totales.totalPuestos = data.length;

                // Contratados únicos para no duplicar si hay puestos en turnos
                const puestosUnicos = new Map();
                data.forEach(item => {
                    if (!puestosUnicos.has(item.id_puesto)) {
                        puestosUnicos.set(item.id_puesto, item.cantidad_contratada || 0);
                    }
                });
                totales.totalContratados = Array.from(puestosUnicos.values()).reduce((sum, v) => sum + v, 0);
                totales.faltantes = Math.max(0, totales.totalContratados - totales.personas);
                totales.porcentajeCobertura = totales.totalContratados > 0 
                    ? Math.round((totales.personas / totales.totalContratados) * 100) 
                    : 100;

            } else if (tipoReporte === 'detalle_puesto') {
                // Reporte acumulado por puesto en el rango con soporte de Ubicación y Puesto
                let queryDetalle = `
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                        COUNT(DISTINCT ad.fecha) AS dias_registrados,
                        ISNULL(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                        ISNULL(AVG(CAST(ad.cantidad_asistentes AS FLOAT)), 0) AS promedio_diario,
                        ISNULL(MAX(ad.cantidad_asistentes), 0) AS max_dia,
                        ISNULL(MIN(ad.cantidad_asistentes), 0) AS min_dia
                    FROM Puestos p
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    LEFT JOIN Asistencias_Diarias ad 
                        ON p.id_puesto = ad.id_puesto 
                        AND ad.fecha >= @inicio AND ad.fecha <= @fin
                `;

                const reqDetalle = pool.request()
                    .input('inicio', sql.Date, fechaInicio)
                    .input('fin', sql.Date, fechaFin);

                if (ubicacionId) {
                    queryDetalle += ` AND ad.id_ubicacion = @ubId`;
                    reqDetalle.input('ubId', sql.Int, ubicacionId);
                }

                queryDetalle += ` WHERE ar.id_area IN (${areaListStr}) AND p.activo = 1 `;

                if (puestoId) {
                    queryDetalle += ` AND p.id_puesto = @puestoId `;
                    reqDetalle.input('puestoId', sql.Int, puestoId);
                }

                queryDetalle += `
                    GROUP BY ar.id_area, ar.nombre, p.id_puesto, p.nombre, p.cantidad_contratada
                    ORDER BY total_asistencias DESC, p.nombre ASC
                `;

                const result = await reqDetalle.query(queryDetalle);
                data = result.recordset.map(item => {
                    const contratada = item.cantidad_contratada || 0;
                    const prom = Number(item.promedio_diario) || 0;
                    const cobertura = contratada > 0 ? Math.round((prom / contratada) * 100) : null;
                    return {
                        ...item,
                        cobertura
                    };
                });

                totales.personas = data.reduce((sum, item) => sum + item.total_asistencias, 0);
                totales.totalPuestos = data.length;
                totales.totalContratados = data.reduce((sum, item) => sum + (item.cantidad_contratada || 0), 0);
                const sumPromedioDiario = data.reduce((sum, item) => sum + Number(item.promedio_diario), 0);
                totales.promedioDiario = Number(sumPromedioDiario.toFixed(1));
                totales.faltantes = Math.max(0, Math.round(totales.totalContratados - totales.promedioDiario));
                totales.porcentajeCobertura = totales.totalContratados > 0 
                    ? Math.round((totales.promedioDiario / totales.totalContratados) * 100) 
                    : 100;

                // GRÁFICO DE COMPORTAMIENTO TEMPORAL POR PUESTOS
                let queryChartPuestos = `
                    SELECT 
                        ad.fecha,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        SUM(ad.cantidad_asistentes) AS total_asistentes
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    WHERE ar.id_area IN (${areaListStr})
                      AND ad.fecha >= @inicio AND ad.fecha <= @fin
                `;

                const reqChartPuestos = pool.request()
                    .input('inicio', sql.Date, fechaInicio)
                    .input('fin', sql.Date, fechaFin);

                if (ubicacionId) {
                    queryChartPuestos += ` AND ad.id_ubicacion = @ubId`;
                    reqChartPuestos.input('ubId', sql.Int, ubicacionId);
                }

                if (puestoId) {
                    queryChartPuestos += ` AND p.id_puesto = @puestoId`;
                    reqChartPuestos.input('puestoId', sql.Int, puestoId);
                }

                queryChartPuestos += `
                    GROUP BY ad.fecha, p.id_puesto, p.nombre
                    ORDER BY ad.fecha ASC, p.nombre ASC
                `;

                const chartPuestosRes = await reqChartPuestos.query(queryChartPuestos);

                const fechasSet = [...new Set(chartPuestosRes.recordset.map(r => r.fecha.toISOString().split('T')[0]))].sort();
                const puestosSet = [...new Set(chartPuestosRes.recordset.map(r => r.puesto_nombre))];

                const datasets = puestosSet.map((puestoNom, idx) => {
                    const color = colorPalette[idx % colorPalette.length];
                    const dataPoints = fechasSet.map(fecha => {
                        const match = chartPuestosRes.recordset.find(r => 
                            r.puesto_nombre === puestoNom && r.fecha.toISOString().split('T')[0] === fecha
                        );
                        return match ? match.total_asistentes : 0;
                    });

                    return {
                        label: puestoNom,
                        data: dataPoints,
                        borderColor: color,
                        backgroundColor: color + '20',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.25,
                        fill: puestosSet.length === 1 // Si solo hay 1 puesto seleccionado, rellenar suavemente debajo de la curva
                    };
                });

                chartDataPuestos = {
                    labels: fechasSet.map(f => {
                        const parts = f.split('-');
                        return `${parts[2]}/${parts[1]}`;
                    }),
                    datasets
                };

            } else {
                // 'resumen_area': Totales y evolución temporal por área
                const result = await pool.request()
                    .input('inicio', sql.Date, fechaInicio)
                    .input('fin', sql.Date, fechaFin)
                    .query(`
                        SELECT 
                            ar.id_area,
                            ar.nombre AS area_nombre,
                            ar.codigo AS area_codigo,
                            COUNT(DISTINCT p.id_puesto) AS total_puestos,
                            ISNULL(plantilla.total_contratados, 0) AS total_contratados,
                            COUNT(DISTINCT ad.fecha) AS dias_con_registro,
                            ISNULL(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                            ISNULL(AVG(CAST(ad.cantidad_asistentes AS FLOAT)), 0) AS promedio_por_puesto
                        FROM Areas ar
                        INNER JOIN Puestos p ON ar.id_area = p.id_area AND p.activo = 1
                        LEFT JOIN (
                            SELECT id_area, SUM(ISNULL(cantidad_contratada, 0)) AS total_contratados
                            FROM Puestos
                            WHERE activo = 1
                            GROUP BY id_area
                        ) plantilla ON ar.id_area = plantilla.id_area
                        LEFT JOIN Asistencias_Diarias ad 
                            ON p.id_puesto = ad.id_puesto 
                            AND ad.fecha >= @inicio AND ad.fecha <= @fin
                        WHERE ar.id_area IN (${areaListStr})
                        GROUP BY ar.id_area, ar.nombre, ar.codigo, plantilla.total_contratados
                        ORDER BY total_asistencias DESC
                    `);
                data = result.recordset.map(item => {
                    const contratada = item.total_contratados || 0;
                    const dias = item.dias_con_registro || 1;
                    const promDiarioArea = dias > 0 ? (item.total_asistencias / dias) : 0;
                    const cobertura = contratada > 0 ? Math.round((promDiarioArea / contratada) * 100) : null;
                    return {
                        ...item,
                        promedio_diario_area: Number(promDiarioArea.toFixed(1)),
                        cobertura
                    };
                });

                totales.personas = data.reduce((sum, item) => sum + item.total_asistencias, 0);
                totales.totalPuestos = data.reduce((sum, item) => sum + item.total_puestos, 0);
                totales.totalContratados = data.reduce((sum, item) => sum + item.total_contratados, 0);
                const sumPromedioDiarioAreas = data.reduce((sum, item) => sum + item.promedio_diario_area, 0);
                totales.promedioDiario = Number(sumPromedioDiarioAreas.toFixed(1));
                totales.faltantes = Math.max(0, Math.round(totales.totalContratados - totales.promedioDiario));
                totales.porcentajeCobertura = totales.totalContratados > 0 
                    ? Math.round((totales.promedioDiario / totales.totalContratados) * 100) 
                    : 100;

                // Gráfico por día y por área
                const chartRes = await pool.request()
                    .input('inicio', sql.Date, fechaInicio)
                    .input('fin', sql.Date, fechaFin)
                    .query(`
                        SELECT 
                            ad.fecha,
                            ar.nombre AS area_nombre,
                            SUM(ad.cantidad_asistentes) AS asistencias
                        FROM Asistencias_Diarias ad
                        INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                        INNER JOIN Areas ar ON p.id_area = ar.id_area
                        WHERE ar.id_area IN (${areaListStr})
                          AND ad.fecha >= @inicio AND ad.fecha <= @fin
                        GROUP BY ad.fecha, ar.nombre
                        ORDER BY ad.fecha ASC, ar.nombre ASC
                    `);

                const fechasSet = [...new Set(chartRes.recordset.map(r => r.fecha.toISOString().split('T')[0]))].sort();
                const areasSet = [...new Set(chartRes.recordset.map(r => r.area_nombre))];

                const datasets = areasSet.map((areaNom, idx) => {
                    const color = colorPalette[idx % colorPalette.length];
                    const dataPoints = fechasSet.map(fecha => {
                        const match = chartRes.recordset.find(r => 
                            r.area_nombre === areaNom && r.fecha.toISOString().split('T')[0] === fecha
                        );
                        return match ? match.asistencias : 0;
                    });

                    return {
                        label: areaNom,
                        data: dataPoints,
                        borderColor: color,
                        backgroundColor: color + '22',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 4,
                        fill: false
                    };
                });

                chartData = {
                    labels: fechasSet.map(f => {
                        const parts = f.split('-');
                        return `${parts[2]}/${parts[1]}`;
                    }),
                    datasets
                };
            }
        }

        return res.json({
            success: true,
            data: {
                tipoReporte,
                fechaInicio,
                fechaFin,
                fechaDiario,
                selectedAreaId: areaId,
                selectedUbicacionId: ubicacionId,
                selectedPuestoId: puestoId,
                areas: reportableAreas,
                ubicacionesFiltro,
                puestosFiltro,
                data,
                totales,
                chartData,
                chartDataPuestos
            }
        });

    } catch (err) {
        console.error('Error al generar reportes:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al procesar el reporte: ' + err.message
        });
    }
}

// Exportar Reporte a Formato Excel Profesional (.xlsx)
async function exportExcel(req, res) {
    const user = req.user || req.session.user;
    const pool = await getPool();

    const tipo = req.query.tipo || 'detalle_puesto';
    const fechaInicio = req.query.fechaInicio || new Date().toISOString().split('T')[0];
    const fechaFin = req.query.fechaFin || new Date().toISOString().split('T')[0];
    const fechaDiario = req.query.fechaDiario || new Date().toISOString().split('T')[0];
    const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    const ubicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const puestoId = req.query.puestoId ? parseInt(req.query.puestoId, 10) : null;

    try {
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const reportableAreas = allowedAreas.filter(a => a.permite_reportes == 1 || user.rol_codigo === 'ADMIN');
        const areaIds = reportableAreas.map(a => a.id_area);

        if (areaIds.length === 0) {
            return res.status(403).send('No tiene áreas asignadas para generar reportes.');
        }

        let filterAreas = areaId ? [areaId] : areaIds;
        if (areaId && !areaIds.includes(areaId)) {
            return res.status(403).send('No tiene permiso en el área especificada.');
        }
        const areaListStr = filterAreas.join(',');

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Registro de Asistencia';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Reporte de Asistencias', {
            views: [{ showGridLines: true }]
        });

        // Título del archivo
        worksheet.mergeCells('A1', 'H1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'REGISTRO DE ASISTENCIA - REPORTE OFICIAL';
        titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;

        // Metadatos
        worksheet.getCell('A2').value = `Generado por: ${user.nombre} (${user.rol_nombre})`;
        worksheet.getCell('A2').font = { italic: true, size: 9 };
        worksheet.getCell('E2').value = `Fecha de emisión: ${new Date().toLocaleString()}`;
        worksheet.getCell('E2').font = { italic: true, size: 9 };

        if (tipo === 'diario') {
            worksheet.getCell('A3').value = `Filtro: Reporte Diario | Fecha: ${fechaDiario}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = ['Área', 'Ubicación / Línea', 'Puesto de Trabajo', 'Plantilla Contratada', 'Modalidad / Turno', 'Cantidad Asistieron', 'Faltantes / Ausentes', '% Cobertura', 'Observaciones', 'Registrado Por', 'Hora Registro'];
            const headerRow = worksheet.getRow(5);
            headerRow.values = headers;
            headerRow.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            headerRow.height = 24;

            let query = `
                SELECT 
                    ar.nombre AS area_nombre,
                    ISNULL(ub.nombre, 'General') AS ubicacion_nombre,
                    p.nombre AS puesto_nombre,
                    ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                    ISNULL(ad.turno, 'UNICO') AS turno,
                    ISNULL(ad.cantidad_asistentes, 0) AS cantidad_asistentes,
                    ad.observaciones,
                    u.nombre AS registrado_por,
                    FORMAT(ad.fecha_registro, 'hh:mm tt') AS hora_registro
                FROM Puestos p
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Asistencias_Diarias ad ON p.id_puesto = ad.id_puesto AND ad.fecha = @fecha
                LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                WHERE ar.id_area IN (${areaListStr}) AND p.activo = 1
            `;

            const reqExcel = pool.request().input('fecha', sql.Date, fechaDiario);

            if (ubicacionId) {
                query += ` AND ad.id_ubicacion = @ubId`;
                reqExcel.input('ubId', sql.Int, ubicacionId);
            }

            if (puestoId) {
                query += ` AND p.id_puesto = @puestoId`;
                reqExcel.input('puestoId', sql.Int, puestoId);
            }

            query += ` ORDER BY ar.nombre ASC, ub.nombre ASC, p.nombre ASC`;

            const resData = await reqExcel.query(query);

            let currentRow = 6;
            let total = 0;
            let totalContratadosExcel = 0;
            let totalFaltantesExcel = 0;
            resData.recordset.forEach(r => {
                const contratada = r.cantidad_contratada || 0;
                const asistentes = r.cantidad_asistentes || 0;
                const faltantes = contratada > 0 ? Math.max(0, contratada - asistentes) : 0;
                const cob = contratada > 0 ? `${Math.round((asistentes / contratada) * 100)}%` : (asistentes > 0 ? '100%' : '0%');

                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.area_nombre,
                    r.ubicacion_nombre,
                    r.puesto_nombre,
                    contratada,
                    r.turno === 'UNICO' ? 'Turno Único' : (r.turno === 'TURNO_1' ? 'Turno 1' : 'Turno 2'),
                    asistentes,
                    faltantes,
                    cob,
                    r.observaciones || '',
                    r.registrado_por || '-',
                    r.hora_registro || '-'
                ];
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(6).alignment = { horizontal: 'center' };
                row.getCell(7).alignment = { horizontal: 'center' };
                row.getCell(8).alignment = { horizontal: 'center' };
                totalContratadosExcel += contratada;
                total += asistentes;
                totalFaltantesExcel += faltantes;
                currentRow++;
            });

            // Fila Total
            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(3).value = 'TOTALES GENERALES:';
            totalRow.getCell(3).font = { bold: true };
            totalRow.getCell(3).alignment = { horizontal: 'right' };
            totalRow.getCell(4).value = totalContratadosExcel;
            totalRow.getCell(4).font = { bold: true };
            totalRow.getCell(4).alignment = { horizontal: 'center' };
            totalRow.getCell(6).value = total;
            totalRow.getCell(6).font = { bold: true };
            totalRow.getCell(6).alignment = { horizontal: 'center' };
            totalRow.getCell(7).value = totalFaltantesExcel;
            totalRow.getCell(7).font = { bold: true };
            totalRow.getCell(7).alignment = { horizontal: 'center' };
            const globalCob = totalContratadosExcel > 0 ? `${Math.round((total / totalContratadosExcel) * 100)}%` : '100%';
            totalRow.getCell(8).value = globalCob;
            totalRow.getCell(8).font = { bold: true };
            totalRow.getCell(8).alignment = { horizontal: 'center' };

        } else if (tipo === 'detalle_puesto') {
            worksheet.getCell('A3').value = `Filtro: Acumulado por Puestos | Periodo: ${fechaInicio} al ${fechaFin}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = ['Área', 'Puesto de Trabajo', 'Plantilla Contratada', 'Días Registrados', 'Total Asistencias', 'Promedio Diario', '% Cumplimiento', 'Máximo Diario', 'Mínimo Diario'];
            const headerRow = worksheet.getRow(5);
            headerRow.values = headers;
            headerRow.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            headerRow.height = 24;

            let query = `
                SELECT 
                    ar.nombre AS area_nombre,
                    p.nombre AS puesto_nombre,
                    ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                    COUNT(DISTINCT ad.fecha) AS dias_registrados,
                    ISNULL(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                    ISNULL(AVG(CAST(ad.cantidad_asistentes AS FLOAT)), 0) AS promedio_diario,
                    ISNULL(MAX(ad.cantidad_asistentes), 0) AS max_dia,
                    ISNULL(MIN(ad.cantidad_asistentes), 0) AS min_dia
                FROM Puestos p
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Asistencias_Diarias ad 
                    ON p.id_puesto = ad.id_puesto 
                    AND ad.fecha >= @inicio AND ad.fecha <= @fin
            `;

            const reqExcel = pool.request()
                .input('inicio', sql.Date, fechaInicio)
                .input('fin', sql.Date, fechaFin);

            if (ubicacionId) {
                query += ` AND ad.id_ubicacion = @ubId`;
                reqExcel.input('ubId', sql.Int, ubicacionId);
            }

            query += ` WHERE ar.id_area IN (${areaListStr}) AND p.activo = 1 `;

            if (puestoId) {
                query += ` AND p.id_puesto = @puestoId `;
                reqExcel.input('puestoId', sql.Int, puestoId);
            }

            query += `
                GROUP BY ar.nombre, p.nombre, p.cantidad_contratada
                ORDER BY total_asistencias DESC, ar.nombre ASC
            `;

            const resData = await reqExcel.query(query);

            let currentRow = 6;
            let sumTotal = 0;
            let sumContratados = 0;
            resData.recordset.forEach(r => {
                const contratada = r.cantidad_contratada || 0;
                const prom = Number(r.promedio_diario) || 0;
                const cob = contratada > 0 ? `${Math.round((prom / contratada) * 100)}%` : '-';

                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.area_nombre,
                    r.puesto_nombre,
                    contratada,
                    r.dias_registrados,
                    r.total_asistencias,
                    prom.toFixed(1),
                    cob,
                    r.max_dia,
                    r.min_dia
                ];
                row.getCell(3).alignment = { horizontal: 'center' };
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(5).alignment = { horizontal: 'center' };
                row.getCell(6).alignment = { horizontal: 'center' };
                row.getCell(7).alignment = { horizontal: 'center' };
                row.getCell(8).alignment = { horizontal: 'center' };
                row.getCell(9).alignment = { horizontal: 'center' };
                sumContratados += contratada;
                sumTotal += r.total_asistencias;
                currentRow++;
            });

            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(2).value = 'TOTALES:';
            totalRow.getCell(2).font = { bold: true };
            totalRow.getCell(2).alignment = { horizontal: 'right' };
            totalRow.getCell(3).value = sumContratados;
            totalRow.getCell(3).font = { bold: true };
            totalRow.getCell(3).alignment = { horizontal: 'center' };
            totalRow.getCell(5).value = sumTotal;
            totalRow.getCell(5).font = { bold: true };
            totalRow.getCell(5).alignment = { horizontal: 'center' };

        } else {
            worksheet.getCell('A3').value = `Filtro: Resumen por Área | Periodo: ${fechaInicio} al ${fechaFin}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = ['Código', 'Nombre del Área', 'Total Puestos', 'Plantilla Contratada', 'Días con Registro', 'Total Asistencias', 'Promedio por Puesto', '% Cumplimiento'];
            const headerRow = worksheet.getRow(5);
            headerRow.values = headers;
            headerRow.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            headerRow.height = 24;

            const resData = await pool.request()
                .input('inicio', sql.Date, fechaInicio)
                .input('fin', sql.Date, fechaFin)
                .query(`
                    SELECT 
                        ar.codigo,
                        ar.nombre AS area_nombre,
                        COUNT(DISTINCT p.id_puesto) AS total_puestos,
                        ISNULL(plantilla.total_contratados, 0) AS total_contratados,
                        COUNT(DISTINCT ad.fecha) AS dias_con_registro,
                        ISNULL(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                        ISNULL(AVG(CAST(ad.cantidad_asistentes AS FLOAT)), 0) AS promedio_por_puesto
                    FROM Areas ar
                    INNER JOIN Puestos p ON ar.id_area = p.id_area AND p.activo = 1
                    LEFT JOIN (
                        SELECT id_area, SUM(ISNULL(cantidad_contratada, 0)) AS total_contratados
                        FROM Puestos
                        WHERE activo = 1
                        GROUP BY id_area
                    ) plantilla ON ar.id_area = plantilla.id_area
                    LEFT JOIN Asistencias_Diarias ad 
                        ON p.id_puesto = ad.id_puesto 
                        AND ad.fecha >= @inicio AND ad.fecha <= @fin
                    WHERE ar.id_area IN (${areaListStr})
                    GROUP BY ar.codigo, ar.nombre, plantilla.total_contratados
                    ORDER BY total_asistencias DESC
                `);

            let currentRow = 6;
            let total = 0;
            let totalContratadosArea = 0;
            resData.recordset.forEach(r => {
                const contratada = r.total_contratados || 0;
                const prom = Number(r.promedio_por_puesto) || 0;
                const dias = r.dias_con_registro || 1;
                const promDiarioArea = dias > 0 ? (r.total_asistencias / dias) : 0;
                const cob = contratada > 0 ? `${Math.round((promDiarioArea / contratada) * 100)}%` : '-';

                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.codigo,
                    r.area_nombre,
                    r.total_puestos,
                    contratada,
                    r.dias_con_registro,
                    r.total_asistencias,
                    prom.toFixed(1),
                    cob
                ];
                row.getCell(1).alignment = { horizontal: 'center' };
                row.getCell(3).alignment = { horizontal: 'center' };
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(5).alignment = { horizontal: 'center' };
                row.getCell(6).alignment = { horizontal: 'center' };
                row.getCell(7).alignment = { horizontal: 'center' };
                row.getCell(8).alignment = { horizontal: 'center' };
                totalContratadosArea += contratada;
                total += r.total_asistencias;
                currentRow++;
            });

            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(3).value = 'TOTALES:';
            totalRow.getCell(3).font = { bold: true };
            totalRow.getCell(3).alignment = { horizontal: 'right' };
            totalRow.getCell(4).value = totalContratadosArea;
            totalRow.getCell(4).font = { bold: true };
            totalRow.getCell(4).alignment = { horizontal: 'center' };
            totalRow.getCell(6).value = total;
            totalRow.getCell(6).font = { bold: true };
            totalRow.getCell(6).alignment = { horizontal: 'center' };
        }

        worksheet.columns.forEach(col => {
            col.width = 22;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Asistencias_${tipo}_${new Date().toISOString().split('T')[0]}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Error al exportar a Excel:', err);
        res.status(500).send('Error al exportar archivo Excel: ' + err.message);
    }
}

module.exports = {
    showReportes,
    exportExcel
};
