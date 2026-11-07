const ExcelJS = require('exceljs');
const { query } = require('../config/db');
const { getUserAllowedAreas, getUserAllowedLocations } = require('../middlewares/auth');
const { autocompletarAsistenciasPasadas } = require('../services/asistenciaService');

// Vista principal de reportes con filtros interactivos
async function showReportes(req, res) {
    const user = req.user || req.session.user;

    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];
    const catorceDiasAtras = new Date();
    catorceDiasAtras.setDate(hoy.getDate() - 14);

    const tipoReporte = req.query.tipo || 'detalle_puesto'; // 'detalle_puesto', 'resumen_area', 'diario'
    const fechaInicio = req.query.fechaInicio || catorceDiasAtras.toISOString().split('T')[0];
    const fechaFin = req.query.fechaFin || hoy.toISOString().split('T')[0];
    const fechaDiario = req.query.fechaDiario || hoy.toISOString().split('T')[0];
    const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    const ubicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const puestoId = req.query.puestoId ? parseInt(req.query.puestoId, 10) : null;

    try {
        if (tipoReporte === 'diario' && fechaDiario < hoyStr) {
            await autocompletarAsistenciasPasadas(fechaDiario, areaId);
        } else {
            autocompletarAsistenciasPasadas().catch(e => console.error('Report background autocomplete error:', e.message));
        }

        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const reportableAreas = allowedAreas.filter(a => a.permite_reportes == 1 || user.rol_codigo === 'ADMIN');
        const areaIds = reportableAreas.map(a => a.id_area);

        let data = [];
        let totales = { personas: 0, promedioDiario: 0, totalPuestos: 0 };
        let chartData = { labels: [], datasets: [] };
        let chartDataPuestos = { labels: [], datasets: [] };
        let ubicacionesFiltro = [];
        let puestosFiltro = [];

        const colorPalette = [
            '#860063', '#F88D2A', '#00A5B5', '#6DBA00', '#7373C0', '#D83548', '#B766A2', '#FBBB7F', '#61C5B8',
            '#2E7D32', '#1565C0', '#C2185B', '#E65100', '#00838F', '#4527A0', '#558B2F', '#4E342E'
        ];

        if (areaIds.length > 0) {
            let filterAreas = areaId ? [areaId] : areaIds;
            if (areaId && !areaIds.includes(areaId)) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para ver reportes del área seleccionada.' });
            }

            if (areaId) {
                ubicacionesFiltro = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, areaId);
                const puestosRes = await query('SELECT id_puesto, nombre FROM Puestos WHERE id_area = ? AND activo = 1 ORDER BY nombre ASC', [areaId]);
                puestosFiltro = puestosRes.recordset;
            } else {
                const placeholdersAll = areaIds.map(() => '?').join(',');
                const puestosRes = await query(
                    `SELECT id_puesto, nombre, id_area FROM Puestos WHERE id_area IN (${placeholdersAll}) AND activo = 1 ORDER BY nombre ASC`,
                    areaIds
                );
                puestosFiltro = puestosRes.recordset;
            }

            const placeholdersFilter = filterAreas.map(() => '?').join(',');

            if (tipoReporte === 'diario') {
                let sqlDiario = `
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        ub.id_ubicacion,
                        ub.nombre AS ubicacion_nombre,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                        COALESCE(ad.turno, 'UNICO') AS turno,
                        COALESCE(ad.cantidad_asistentes, 0) AS cantidad_asistentes,
                        ad.observaciones,
                        ad.fecha_registro,
                        strftime('%H:%M', ad.fecha_registro) AS hora_registro_texto,
                        strftime('%d/%m/%Y %H:%M', ad.fecha_registro) AS fecha_registro_texto,
                        u.nombre AS registrado_por
                    FROM Puestos p
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    LEFT JOIN Asistencias_Diarias ad ON p.id_puesto = ad.id_puesto AND ad.fecha = ?
                    LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                    LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                    WHERE ar.id_area IN (${placeholdersFilter}) AND p.activo = 1
                `;
                const paramsDiario = [fechaDiario, ...filterAreas];

                if (ubicacionId) {
                    sqlDiario += ` AND ad.id_ubicacion = ?`;
                    paramsDiario.push(ubicacionId);
                }

                if (puestoId) {
                    sqlDiario += ` AND p.id_puesto = ?`;
                    paramsDiario.push(puestoId);
                }

                sqlDiario += ` ORDER BY ar.nombre ASC, ub.nombre ASC, p.nombre ASC, ad.turno ASC`;

                const resDiario = await query(sqlDiario, paramsDiario);
                data = resDiario.recordset;

                totales.personas = data.reduce((sum, item) => sum + (item.cantidad_asistentes || 0), 0);
                totales.totalPuestos = data.length;

                // Datos de gráfica circular por área
                const areasAgrupadas = {};
                data.forEach(item => {
                    const aName = item.area_nombre;
                    areasAgrupadas[aName] = (areasAgrupadas[aName] || 0) + item.cantidad_asistentes;
                });

                chartData = {
                    labels: Object.keys(areasAgrupadas),
                    datasets: [{
                        data: Object.values(areasAgrupadas),
                        backgroundColor: colorPalette.slice(0, Object.keys(areasAgrupadas).length)
                    }]
                };

            } else if (tipoReporte === 'detalle_puesto') {
                let sqlPuestos = `
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        COUNT(DISTINCT ad.fecha) AS dias_registrados,
                        COALESCE(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                        COALESCE(AVG(CAST(ad.cantidad_asistentes AS REAL)), 0) AS promedio_diario,
                        COALESCE(MAX(ad.cantidad_asistentes), 0) AS max_dia,
                        COALESCE(MIN(ad.cantidad_asistentes), 0) AS min_dia
                    FROM Puestos p
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    LEFT JOIN Asistencias_Diarias ad 
                        ON p.id_puesto = ad.id_puesto 
                        AND ad.fecha >= ? AND ad.fecha <= ?
                `;
                const paramsPuestos = [fechaInicio, fechaFin];

                if (ubicacionId) {
                    sqlPuestos += ` AND ad.id_ubicacion = ?`;
                    paramsPuestos.push(ubicacionId);
                }

                sqlPuestos += ` WHERE ar.id_area IN (${placeholdersFilter}) AND p.activo = 1`;
                paramsPuestos.push(...filterAreas);

                if (puestoId) {
                    sqlPuestos += ` AND p.id_puesto = ?`;
                    paramsPuestos.push(puestoId);
                }

                sqlPuestos += `
                    GROUP BY ar.id_area, ar.nombre, p.id_puesto, p.nombre
                    ORDER BY total_asistencias DESC, ar.nombre ASC, p.nombre ASC
                `;

                const resPuestos = await query(sqlPuestos, paramsPuestos);
                data = resPuestos.recordset;

                totales.personas = data.reduce((sum, item) => sum + (item.total_asistencias || 0), 0);
                totales.totalPuestos = data.length;
                totales.promedioDiario = totales.totalPuestos > 0 ? (totales.personas / totales.totalPuestos).toFixed(1) : 0;

                // Evolución temporal por puesto
                let sqlChartPuestos = `
                    SELECT 
                        ad.fecha,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        SUM(ad.cantidad_asistentes) AS total_asistentes
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    WHERE ar.id_area IN (${placeholdersFilter})
                      AND ad.fecha >= ? AND ad.fecha <= ?
                `;
                const paramsChart = [...filterAreas, fechaInicio, fechaFin];

                if (ubicacionId) {
                    sqlChartPuestos += ` AND ad.id_ubicacion = ?`;
                    paramsChart.push(ubicacionId);
                }

                if (puestoId) {
                    sqlChartPuestos += ` AND p.id_puesto = ?`;
                    paramsChart.push(puestoId);
                }

                sqlChartPuestos += `
                    GROUP BY ad.fecha, p.id_puesto, p.nombre
                    ORDER BY ad.fecha ASC, p.nombre ASC
                `;

                const chartPuestosRes = await query(sqlChartPuestos, paramsChart);

                const fechasSet = [...new Set(chartPuestosRes.recordset.map(r => String(r.fecha).substring(0, 10)))].sort();
                const puestosSet = [...new Set(chartPuestosRes.recordset.map(r => r.puesto_nombre))];

                const datasets = puestosSet.map((puestoNom, idx) => {
                    const color = colorPalette[idx % colorPalette.length];
                    const dataPoints = fechasSet.map(fecha => {
                        const match = chartPuestosRes.recordset.find(r => 
                            r.puesto_nombre === puestoNom && String(r.fecha).substring(0, 10) === fecha
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
                        fill: puestosSet.length === 1
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
                // 'resumen_area'
                const resArea = await query(`
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        ar.codigo AS area_codigo,
                        COUNT(DISTINCT p.id_puesto) AS total_puestos,
                        COUNT(DISTINCT ad.fecha) AS dias_con_registro,
                        COALESCE(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                        COALESCE(AVG(CAST(ad.cantidad_asistentes AS REAL)), 0) AS promedio_por_puesto
                    FROM Areas ar
                    INNER JOIN Puestos p ON ar.id_area = p.id_area AND p.activo = 1
                    LEFT JOIN Asistencias_Diarias ad 
                        ON p.id_puesto = ad.id_puesto 
                        AND ad.fecha >= ? AND ad.fecha <= ?
                    WHERE ar.id_area IN (${placeholdersFilter})
                    GROUP BY ar.id_area, ar.nombre, ar.codigo
                    ORDER BY total_asistencias DESC
                `, [fechaInicio, fechaFin, ...filterAreas]);

                data = resArea.recordset;
                totales.personas = data.reduce((sum, item) => sum + (item.total_asistencias || 0), 0);

                const chartRes = await query(`
                    SELECT 
                        ad.fecha,
                        ar.nombre AS area_nombre,
                        SUM(ad.cantidad_asistentes) AS asistencias
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    WHERE ar.id_area IN (${placeholdersFilter})
                      AND ad.fecha >= ? AND ad.fecha <= ?
                    GROUP BY ad.fecha, ar.nombre
                    ORDER BY ad.fecha ASC, ar.nombre ASC
                `, [...filterAreas, fechaInicio, fechaFin]);

                const fechasSet = [...new Set(chartRes.recordset.map(r => String(r.fecha).substring(0, 10)))].sort();
                const areasSet = [...new Set(chartRes.recordset.map(r => r.area_nombre))];

                const datasets = areasSet.map((areaNom, idx) => {
                    const color = colorPalette[idx % colorPalette.length];
                    const dataPoints = fechasSet.map(fecha => {
                        const match = chartRes.recordset.find(r => 
                            r.area_nombre === areaNom && String(r.fecha).substring(0, 10) === fecha
                        );
                        return match ? match.asistencias : 0;
                    });

                    return {
                        label: areaNom,
                        data: dataPoints,
                        borderColor: color,
                        backgroundColor: color + '20',
                        borderWidth: 2,
                        tension: 0.3
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

// Exportar a Excel (.xlsx)
async function exportExcel(req, res) {
    const user = req.user || req.session.user;

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

        const placeholdersFilter = filterAreas.map(() => '?').join(',');

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Registro de Asistencia';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Reporte de Asistencias', {
            views: [{ showGridLines: true }]
        });

        worksheet.mergeCells('A1', 'H1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'REGISTRO DE ASISTENCIA - REPORTE OFICIAL';
        titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;

        worksheet.getCell('A2').value = `Generado por: ${user.nombre} (${user.rol_nombre || 'Usuario'})`;
        worksheet.getCell('A2').font = { italic: true, size: 9 };
        worksheet.getCell('E2').value = `Fecha de emisión: ${new Date().toLocaleString()}`;
        worksheet.getCell('E2').font = { italic: true, size: 9 };

        if (tipo === 'diario') {
            worksheet.getCell('A3').value = `Filtro: Reporte Diario | Fecha: ${fechaDiario}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = ['Área', 'Ubicación / Línea', 'Puesto de Trabajo', 'Modalidad / Turno', 'Cantidad Asistieron', 'Observaciones', 'Registrado Por', 'Hora Registro'];
            const headerRow = worksheet.getRow(5);
            headerRow.values = headers;
            headerRow.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            headerRow.height = 24;

            let querySql = `
                SELECT 
                    ar.nombre AS area_nombre,
                    COALESCE(ub.nombre, 'General') AS ubicacion_nombre,
                    p.nombre AS puesto_nombre,
                    COALESCE(ad.turno, 'UNICO') AS turno,
                    COALESCE(ad.cantidad_asistentes, 0) AS cantidad_asistentes,
                    ad.observaciones,
                    u.nombre AS registrado_por,
                    strftime('%H:%M', ad.fecha_registro) AS hora_registro
                FROM Puestos p
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Asistencias_Diarias ad ON p.id_puesto = ad.id_puesto AND ad.fecha = ?
                LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                WHERE ar.id_area IN (${placeholdersFilter}) AND p.activo = 1
            `;
            const paramsExcel = [fechaDiario, ...filterAreas];

            if (ubicacionId) {
                querySql += ` AND ad.id_ubicacion = ?`;
                paramsExcel.push(ubicacionId);
            }

            if (puestoId) {
                querySql += ` AND p.id_puesto = ?`;
                paramsExcel.push(puestoId);
            }

            querySql += ` ORDER BY ar.nombre ASC, ub.nombre ASC, p.nombre ASC`;

            const resData = await query(querySql, paramsExcel);

            let currentRow = 6;
            let total = 0;
            resData.recordset.forEach(r => {
                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.area_nombre,
                    r.ubicacion_nombre,
                    r.puesto_nombre,
                    r.turno === 'UNICO' ? 'Turno Único' : (r.turno === 'TURNO_1' ? 'Turno 1' : 'Turno 2'),
                    r.cantidad_asistentes,
                    r.observaciones || '',
                    r.registrado_por || '-',
                    r.hora_registro || '-'
                ];
                row.getCell(5).alignment = { horizontal: 'center' };
                total += r.cantidad_asistentes;
                currentRow++;
            });

            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(4).value = 'TOTAL GENERAL:';
            totalRow.getCell(4).font = { bold: true };
            totalRow.getCell(4).alignment = { horizontal: 'right' };
            totalRow.getCell(5).value = total;
            totalRow.getCell(5).font = { bold: true };
            totalRow.getCell(5).alignment = { horizontal: 'center' };

        } else if (tipo === 'detalle_puesto') {
            worksheet.getCell('A3').value = `Filtro: Acumulado por Puestos | Periodo: ${fechaInicio} al ${fechaFin}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = ['Área', 'Puesto de Trabajo', 'Días Registrados', 'Total Asistencias', 'Promedio Diario', 'Máximo Diario', 'Mínimo Diario'];
            const headerRow = worksheet.getRow(5);
            headerRow.values = headers;
            headerRow.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            headerRow.height = 24;

            let querySql = `
                SELECT 
                    ar.nombre AS area_nombre,
                    p.nombre AS puesto_nombre,
                    COUNT(DISTINCT ad.fecha) AS dias_registrados,
                    COALESCE(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                    COALESCE(AVG(CAST(ad.cantidad_asistentes AS REAL)), 0) AS promedio_diario,
                    COALESCE(MAX(ad.cantidad_asistentes), 0) AS max_dia,
                    COALESCE(MIN(ad.cantidad_asistentes), 0) AS min_dia
                FROM Puestos p
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Asistencias_Diarias ad 
                    ON p.id_puesto = ad.id_puesto 
                    AND ad.fecha >= ? AND ad.fecha <= ?
            `;
            const paramsExcel = [fechaInicio, fechaFin];

            if (ubicacionId) {
                querySql += ` AND ad.id_ubicacion = ?`;
                paramsExcel.push(ubicacionId);
            }

            querySql += ` WHERE ar.id_area IN (${placeholdersFilter}) AND p.activo = 1 `;
            paramsExcel.push(...filterAreas);

            if (puestoId) {
                querySql += ` AND p.id_puesto = ? `;
                paramsExcel.push(puestoId);
            }

            querySql += `
                GROUP BY ar.nombre, p.nombre
                ORDER BY total_asistencias DESC, ar.nombre ASC
            `;

            const resData = await query(querySql, paramsExcel);

            let currentRow = 6;
            let sumTotal = 0;
            resData.recordset.forEach(r => {
                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.area_nombre,
                    r.puesto_nombre,
                    r.dias_registrados,
                    r.total_asistencias,
                    Number(r.promedio_diario).toFixed(1),
                    r.max_dia,
                    r.min_dia
                ];
                row.getCell(3).alignment = { horizontal: 'center' };
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(5).alignment = { horizontal: 'center' };
                row.getCell(6).alignment = { horizontal: 'center' };
                row.getCell(7).alignment = { horizontal: 'center' };
                sumTotal += r.total_asistencias;
                currentRow++;
            });

            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(3).value = 'TOTAL ASISTENCIAS:';
            totalRow.getCell(3).font = { bold: true };
            totalRow.getCell(3).alignment = { horizontal: 'right' };
            totalRow.getCell(4).value = sumTotal;
            totalRow.getCell(4).font = { bold: true };
            totalRow.getCell(4).alignment = { horizontal: 'center' };

        } else {
            worksheet.getCell('A3').value = `Filtro: Resumen por Área | Periodo: ${fechaInicio} al ${fechaFin}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = ['Código', 'Nombre del Área', 'Total Puestos', 'Días con Registro', 'Total Asistencias', 'Promedio por Puesto'];
            const headerRow = worksheet.getRow(5);
            headerRow.values = headers;
            headerRow.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF860063' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
            headerRow.height = 24;

            const resData = await query(`
                SELECT 
                    ar.codigo,
                    ar.nombre AS area_nombre,
                    COUNT(DISTINCT p.id_puesto) AS total_puestos,
                    COUNT(DISTINCT ad.fecha) AS dias_con_registro,
                    COALESCE(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                    COALESCE(AVG(CAST(ad.cantidad_asistentes AS REAL)), 0) AS promedio_por_puesto
                FROM Areas ar
                INNER JOIN Puestos p ON ar.id_area = p.id_area AND p.activo = 1
                LEFT JOIN Asistencias_Diarias ad 
                    ON p.id_puesto = ad.id_puesto 
                    AND ad.fecha >= ? AND ad.fecha <= ?
                WHERE ar.id_area IN (${placeholdersFilter})
                GROUP BY ar.codigo, ar.nombre
                ORDER BY total_asistencias DESC
            `, [fechaInicio, fechaFin, ...filterAreas]);

            let currentRow = 6;
            let total = 0;
            resData.recordset.forEach(r => {
                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.codigo,
                    r.area_nombre,
                    r.total_puestos,
                    r.dias_con_registro,
                    r.total_asistencias,
                    Number(r.promedio_por_puesto).toFixed(1)
                ];
                row.getCell(1).alignment = { horizontal: 'center' };
                row.getCell(3).alignment = { horizontal: 'center' };
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(5).alignment = { horizontal: 'center' };
                row.getCell(6).alignment = { horizontal: 'center' };
                total += r.total_asistencias;
                currentRow++;
            });

            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(4).value = 'TOTAL ASISTENCIAS:';
            totalRow.getCell(4).font = { bold: true };
            totalRow.getCell(4).alignment = { horizontal: 'right' };
            totalRow.getCell(5).value = total;
            totalRow.getCell(5).font = { bold: true };
            totalRow.getCell(5).alignment = { horizontal: 'center' };
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
