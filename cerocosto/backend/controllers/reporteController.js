const ExcelJS = require('exceljs');
const { query } = require('../config/db');
const { getUserAllowedAreas, getUserAllowedLocations } = require('../middlewares/auth');
const { autocompletarAsistenciasPasadas, getLocalDateStr } = require('../services/asistenciaService');

// Vista principal de reportes con filtros interactivos
async function showReportes(req, res) {
    const user = req.user || req.session.user;

    const hoyStr = getLocalDateStr();
    const catorceDiasAtras = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const fechaInicioDefault = getLocalDateStr(catorceDiasAtras);

    const tipoReporte = req.query.tipo || 'detalle_puesto'; // 'detalle_puesto', 'resumen_area', 'diario', 'comparativa'
    const fechaInicio = req.query.fechaInicio || fechaInicioDefault;
    const fechaFin = req.query.fechaFin || hoyStr;
    const fechaDiario = req.query.fechaDiario || hoyStr;
    const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    const ubicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const puestoId = req.query.puestoId ? parseInt(req.query.puestoId, 10) : null;

    try {
        if ((tipoReporte === 'diario' || tipoReporte === 'comparativa') && fechaDiario < hoyStr) {
            await autocompletarAsistenciasPasadas(fechaDiario, areaId);
        } else {
            autocompletarAsistenciasPasadas().catch(e => console.error('Report background autocomplete error:', e.message));
        }

        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const reportableAreas = allowedAreas.filter(a => a.permite_reportes == 1 || user.rol_codigo === 'ADMIN');
        const areaIds = reportableAreas.map(a => a.id_area);

        let data = [];
        let resumenAreas = [];
        let totales = { personas: 0, promedioDiario: 0, totalPuestos: 0, totalContratados: 0, faltantes: 0, porcentajeCobertura: 100, diferenciaNeta: 0, excedentes: 0, puestosCompletos: 0, puestosDeficit: 0, puestosExcedente: 0, puestosSinAsistencia: 0 };
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

            if (tipoReporte === 'comparativa') {
                let sqlComp = `
                    SELECT 
                        ar.id_area,
                        ar.codigo AS area_codigo,
                        ar.nombre AS area_nombre,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
                        COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                        COALESCE(SUM(ad.cantidad_asistentes), 0) AS cantidad_asistentes,
                        COUNT(ad.id_asistencia) AS registros_turnos
                    FROM Puestos p
                    INNER JOIN Areas ar ON p.id_area = ar.id_area
                    LEFT JOIN Asistencias_Diarias ad ON p.id_puesto = ad.id_puesto AND ad.fecha = ?
                    WHERE ar.id_area IN (${placeholdersFilter}) AND p.activo = 1
                `;
                const paramsComp = [fechaDiario, ...filterAreas];

                if (areaId) {
                    sqlComp += ` AND ar.id_area = ?`;
                    paramsComp.push(areaId);
                }

                if (puestoId) {
                    sqlComp += ` AND p.id_puesto = ?`;
                    paramsComp.push(puestoId);
                }

                sqlComp += `
                    GROUP BY ar.id_area, ar.codigo, ar.nombre, p.id_puesto, p.nombre, p.cantidad_contratada, p.aplica_turnos
                    ORDER BY ar.nombre ASC, p.nombre ASC
                `;

                const resComp = await query(sqlComp, paramsComp);

                let totalContratadosSum = 0;
                let totalAsistentesSum = 0;
                let totalFaltantesSum = 0;
                let totalExcedentesSum = 0;
                let puestosCompletos = 0;
                let puestosDeficit = 0;
                let puestosExcedente = 0;
                let puestosSinAsistencia = 0;

                data = resComp.recordset.map(item => {
                    const contratada = item.cantidad_contratada || 0;
                    const asistentes = item.cantidad_asistentes || 0;
                    const diferencia = asistentes - contratada;
                    const faltantes = contratada > 0 ? Math.max(0, contratada - asistentes) : 0;
                    const excedentes = contratada > 0 ? Math.max(0, asistentes - contratada) : asistentes;
                    const porcentaje = contratada > 0 ? Math.round((asistentes / contratada) * 100) : (asistentes > 0 ? 100 : 0);

                    let estado = 'COMPLETO';
                    let estadoLabel = 'Completo';
                    let estadoBadge = 'bg-success-subtle text-success border border-success-subtle';

                    if (asistentes === 0 && contratada > 0) {
                        estado = 'SIN_ASISTENCIA';
                        estadoLabel = 'Sin Asistencia';
                        estadoBadge = 'bg-secondary-subtle text-secondary border border-secondary-subtle';
                        puestosSinAsistencia++;
                        puestosDeficit++;
                    } else if (diferencia < 0) {
                        if (porcentaje < 80) {
                            estado = 'DEFICIT_CRITICO';
                            estadoLabel = 'Déficit Crítico';
                            estadoBadge = 'bg-danger-subtle text-danger border border-danger-subtle';
                        } else {
                            estado = 'DEFICIT_LEVE';
                            estadoLabel = 'Faltante';
                            estadoBadge = 'bg-warning-subtle text-warning-emphasis border border-warning-subtle';
                        }
                        puestosDeficit++;
                    } else if (diferencia > 0) {
                        estado = 'EXCEDENTE';
                        estadoLabel = 'Excedente';
                        estadoBadge = 'bg-primary-subtle text-primary border border-primary-subtle';
                        puestosExcedente++;
                    } else {
                        puestosCompletos++;
                    }

                    totalContratadosSum += contratada;
                    totalAsistentesSum += asistentes;
                    totalFaltantesSum += faltantes;
                    totalExcedentesSum += (diferencia > 0 ? diferencia : 0);

                    return {
                        ...item,
                        contratada,
                        asistentes,
                        diferencia,
                        faltantes,
                        excedentes,
                        porcentaje,
                        estado,
                        estadoLabel,
                        estadoBadge
                    };
                });

                totales.personas = totalAsistentesSum;
                totales.totalContratados = totalContratadosSum;
                totales.faltantes = totalFaltantesSum;
                totales.excedentes = totalExcedentesSum;
                totales.diferenciaNeta = totalAsistentesSum - totalContratadosSum;
                totales.totalPuestos = data.length;
                totales.porcentajeCobertura = totalContratadosSum > 0 
                    ? Math.round((totalAsistentesSum / totalContratadosSum) * 100) 
                    : (totalAsistentesSum > 0 ? 100 : 0);
                totales.puestosCompletos = puestosCompletos;
                totales.puestosDeficit = puestosDeficit;
                totales.puestosExcedente = puestosExcedente;
                totales.puestosSinAsistencia = puestosSinAsistencia;

                const areaMap = new Map();
                data.forEach(item => {
                    if (!areaMap.has(item.id_area)) {
                        areaMap.set(item.id_area, {
                            id_area: item.id_area,
                            area_nombre: item.area_nombre,
                            area_codigo: item.area_codigo,
                            contratada: 0,
                            asistentes: 0,
                            puestosCount: 0
                        });
                    }
                    const a = areaMap.get(item.id_area);
                    a.contratada += item.contratada;
                    a.asistentes += item.asistentes;
                    a.puestosCount++;
                });

                resumenAreas = Array.from(areaMap.values()).map(a => {
                    const dif = a.asistentes - a.contratada;
                    const pct = a.contratada > 0 ? Math.round((a.asistentes / a.contratada) * 100) : (a.asistentes > 0 ? 100 : 0);
                    return {
                        ...a,
                        diferencia: dif,
                        porcentaje: pct
                    };
                });

                chartData = {
                    labels: resumenAreas.map(a => a.area_nombre),
                    datasets: [
                        {
                            label: 'Plantilla Contratada',
                            data: resumenAreas.map(a => a.contratada),
                            backgroundColor: '#7373C0',
                            borderColor: '#54549E',
                            borderWidth: 1.5,
                            borderRadius: 4
                        },
                        {
                            label: 'Personal Asistió',
                            data: resumenAreas.map(a => a.asistentes),
                            backgroundColor: '#6DBA00',
                            borderColor: '#528C00',
                            borderWidth: 1.5,
                            borderRadius: 4
                        }
                    ]
                };

            } else if (tipoReporte === 'diario') {
                let sqlDiario = `
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        ub.id_ubicacion,
                        ub.nombre AS ubicacion_nombre,
                        p.id_puesto,
                        p.nombre AS puesto_nombre,
                        COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                        COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
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
                data = resDiario.recordset.map(item => {
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

                totales.personas = data.reduce((sum, item) => sum + (item.cantidad_asistentes || 0), 0);
                totales.totalPuestos = data.length;

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
                        COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
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
                    GROUP BY ar.id_area, ar.nombre, p.id_puesto, p.nombre, p.cantidad_contratada
                    ORDER BY total_asistencias DESC, ar.nombre ASC, p.nombre ASC
                `;

                const resPuestos = await query(sqlPuestos, paramsPuestos);
                data = resPuestos.recordset.map(item => {
                    const contratada = item.cantidad_contratada || 0;
                    const prom = Number(item.promedio_diario) || 0;
                    const cobertura = contratada > 0 ? Math.round((prom / contratada) * 100) : null;
                    return {
                        ...item,
                        cobertura
                    };
                });

                totales.personas = data.reduce((sum, item) => sum + (item.total_asistencias || 0), 0);
                totales.totalPuestos = data.length;
                totales.totalContratados = data.reduce((sum, item) => sum + (item.cantidad_contratada || 0), 0);
                const sumPromedioDiario = data.reduce((sum, item) => sum + Number(item.promedio_diario), 0);
                totales.promedioDiario = Number(sumPromedioDiario.toFixed(1));
                totales.faltantes = Math.max(0, Math.round(totales.totalContratados - totales.promedioDiario));
                totales.porcentajeCobertura = totales.totalContratados > 0 
                    ? Math.round((totales.promedioDiario / totales.totalContratados) * 100) 
                    : 100;

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
                        COALESCE(plantilla.total_contratados, 0) AS total_contratados,
                        COUNT(DISTINCT ad.fecha) AS dias_con_registro,
                        COALESCE(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                        COALESCE(AVG(CAST(ad.cantidad_asistentes AS REAL)), 0) AS promedio_por_puesto
                    FROM Areas ar
                    INNER JOIN Puestos p ON ar.id_area = p.id_area AND p.activo = 1
                    LEFT JOIN (
                        SELECT id_area, SUM(COALESCE(cantidad_contratada, 0)) AS total_contratados
                        FROM Puestos
                        WHERE activo = 1
                        GROUP BY id_area
                    ) plantilla ON ar.id_area = plantilla.id_area
                    LEFT JOIN Asistencias_Diarias ad 
                        ON p.id_puesto = ad.id_puesto 
                        AND ad.fecha >= ? AND ad.fecha <= ?
                    WHERE ar.id_area IN (${placeholdersFilter})
                    GROUP BY ar.id_area, ar.nombre, ar.codigo, plantilla.total_contratados
                    ORDER BY total_asistencias DESC
                `, [fechaInicio, fechaFin, ...filterAreas]);

                data = resArea.recordset.map(item => {
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

                totales.personas = data.reduce((sum, item) => sum + (item.total_asistencias || 0), 0);
                totales.totalPuestos = data.reduce((sum, item) => sum + item.total_puestos, 0);
                totales.totalContratados = data.reduce((sum, item) => sum + item.total_contratados, 0);
                const sumPromedioDiarioAreas = data.reduce((sum, item) => sum + item.promedio_diario_area, 0);
                totales.promedioDiario = Number(sumPromedioDiarioAreas.toFixed(1));
                totales.faltantes = Math.max(0, Math.round(totales.totalContratados - totales.promedioDiario));
                totales.porcentajeCobertura = totales.totalContratados > 0 
                    ? Math.round((totales.promedioDiario / totales.totalContratados) * 100) 
                    : 100;

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
                resumenAreas,
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

    const hoyStr = getLocalDateStr();
    const catorceDiasAtras = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const fechaInicioDefault = getLocalDateStr(catorceDiasAtras);

    const tipo = req.query.tipo || 'detalle_puesto';
    const fechaInicio = req.query.fechaInicio || fechaInicioDefault;
    const fechaFin = req.query.fechaFin || hoyStr;
    const fechaDiario = req.query.fechaDiario || hoyStr;
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

        if (tipo === 'comparativa') {
            worksheet.getCell('A3').value = `Filtro: Comparativa Plantilla vs Asistencia | Fecha: ${fechaDiario}`;
            worksheet.getCell('A3').font = { bold: true, size: 10 };

            const headers = [
                'Área Operativa',
                'Cargo / Puesto de Trabajo',
                'Modalidad Turnos',
                'Plantilla Contratada',
                'Asistencia Real',
                'Diferencia (Variación)',
                '% Cumplimiento',
                'Estado'
            ];
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
                    COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
                    COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                    COALESCE(SUM(ad.cantidad_asistentes), 0) AS cantidad_asistentes
                FROM Puestos p
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Asistencias_Diarias ad ON p.id_puesto = ad.id_puesto AND ad.fecha = ?
                WHERE ar.id_area IN (${placeholdersFilter}) AND p.activo = 1
            `;
            const paramsExcel = [fechaDiario, ...filterAreas];

            if (areaId) {
                querySql += ` AND ar.id_area = ?`;
                paramsExcel.push(areaId);
            }

            if (puestoId) {
                querySql += ` AND p.id_puesto = ?`;
                paramsExcel.push(puestoId);
            }

            querySql += `
                GROUP BY ar.nombre, p.nombre, p.cantidad_contratada, p.aplica_turnos
                ORDER BY ar.nombre ASC, p.nombre ASC
            `;

            const resData = await query(querySql, paramsExcel);

            let currentRow = 6;
            let totalContratadosExcel = 0;
            let totalAsistentesExcel = 0;
            let totalDiferenciaExcel = 0;

            resData.recordset.forEach(r => {
                const contratada = r.cantidad_contratada || 0;
                const asistentes = r.cantidad_asistentes || 0;
                const dif = asistentes - contratada;
                const pct = contratada > 0 ? Math.round((asistentes / contratada) * 100) : (asistentes > 0 ? 100 : 0);
                
                let estadoStr = 'Completo';
                if (asistentes === 0 && contratada > 0) estadoStr = 'Sin Asistencia';
                else if (dif < 0) estadoStr = pct < 80 ? 'Déficit Crítico' : 'Faltante';
                else if (dif > 0) estadoStr = 'Excedente';

                const row = worksheet.getRow(currentRow);
                row.values = [
                    r.area_nombre,
                    r.puesto_nombre,
                    r.aplica_turnos ? '2 Turnos' : 'Turno Único',
                    contratada,
                    asistentes,
                    dif > 0 ? `+${dif}` : dif,
                    `${pct}%`,
                    estadoStr
                ];

                row.getCell(3).alignment = { horizontal: 'center' };
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(5).alignment = { horizontal: 'center' };
                row.getCell(6).alignment = { horizontal: 'center' };
                row.getCell(7).alignment = { horizontal: 'center' };
                row.getCell(8).alignment = { horizontal: 'center' };

                if (dif < 0) {
                    row.getCell(6).font = { color: { argb: 'FFD83548' }, bold: true };
                } else if (dif > 0) {
                    row.getCell(6).font = { color: { argb: 'FF1565C0' }, bold: true };
                } else {
                    row.getCell(6).font = { color: { argb: 'FF2E7D32' }, bold: true };
                }

                totalContratadosExcel += contratada;
                totalAsistentesExcel += asistentes;
                totalDiferenciaExcel += dif;
                currentRow++;
            });

            // Fila Total
            const totalRow = worksheet.getRow(currentRow);
            totalRow.getCell(3).value = 'TOTALES:';
            totalRow.getCell(3).font = { bold: true };
            totalRow.getCell(3).alignment = { horizontal: 'right' };
            totalRow.getCell(4).value = totalContratadosExcel;
            totalRow.getCell(4).font = { bold: true };
            totalRow.getCell(4).alignment = { horizontal: 'center' };
            totalRow.getCell(5).value = totalAsistentesExcel;
            totalRow.getCell(5).font = { bold: true };
            totalRow.getCell(5).alignment = { horizontal: 'center' };
            totalRow.getCell(6).value = totalDiferenciaExcel > 0 ? `+${totalDiferenciaExcel}` : totalDiferenciaExcel;
            totalRow.getCell(6).font = { bold: true };
            totalRow.getCell(6).alignment = { horizontal: 'center' };
            const globalCob = totalContratadosExcel > 0 ? `${Math.round((totalAsistentesExcel / totalContratadosExcel) * 100)}%` : '100%';
            totalRow.getCell(7).value = globalCob;
            totalRow.getCell(7).font = { bold: true };
            totalRow.getCell(7).alignment = { horizontal: 'center' };
            totalRow.getCell(8).value = totalDiferenciaExcel < 0 ? 'Con Faltantes' : (totalDiferenciaExcel > 0 ? 'Con Excedente' : 'Plantilla Completa');
            totalRow.getCell(8).font = { bold: true };
            totalRow.getCell(8).alignment = { horizontal: 'center' };

        } else if (tipo === 'diario') {
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

            let querySql = `
                SELECT 
                    ar.nombre AS area_nombre,
                    COALESCE(ub.nombre, 'General') AS ubicacion_nombre,
                    p.nombre AS puesto_nombre,
                    COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
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

            let querySql = `
                SELECT 
                    ar.nombre AS area_nombre,
                    p.nombre AS puesto_nombre,
                    COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
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
                GROUP BY ar.nombre, p.nombre, p.cantidad_contratada
                ORDER BY total_asistencias DESC, ar.nombre ASC
            `;

            const resData = await query(querySql, paramsExcel);

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

            const resData = await query(`
                SELECT 
                    ar.codigo,
                    ar.nombre AS area_nombre,
                    COUNT(DISTINCT p.id_puesto) AS total_puestos,
                    COALESCE(plantilla.total_contratados, 0) AS total_contratados,
                    COUNT(DISTINCT ad.fecha) AS dias_con_registro,
                    COALESCE(SUM(ad.cantidad_asistentes), 0) AS total_asistencias,
                    COALESCE(AVG(CAST(ad.cantidad_asistentes AS REAL)), 0) AS promedio_por_puesto
                FROM Areas ar
                INNER JOIN Puestos p ON ar.id_area = p.id_area AND p.activo = 1
                LEFT JOIN (
                    SELECT id_area, SUM(COALESCE(cantidad_contratada, 0)) AS total_contratados
                    FROM Puestos
                    WHERE activo = 1
                    GROUP BY id_area
                ) plantilla ON ar.id_area = plantilla.id_area
                LEFT JOIN Asistencias_Diarias ad 
                    ON p.id_puesto = ad.id_puesto 
                    AND ad.fecha >= ? AND ad.fecha <= ?
                WHERE ar.id_area IN (${placeholdersFilter})
                GROUP BY ar.codigo, ar.nombre, plantilla.total_contratados
                ORDER BY total_asistencias DESC
            `, [fechaInicio, fechaFin, ...filterAreas]);

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
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Asistencias_${tipo}_${hoyStr}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Error al exportar a Excel:', err);
        res.status(500).send('Error al exportar archivo Excel: ' + err.message);
    }
}

// Exportar respaldo forense completo de la base de datos en formato SQL
async function exportSqlBackup(req, res) {
    const user = req.user || (req.session && req.session.user);
    if (!user || user.rol_codigo !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: Solo los administradores pueden generar respaldos de la base de datos.'
        });
    }

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
        const tables = [
            'Roles',
            'Areas',
            'Ubicaciones',
            'Puestos',
            'Usuarios',
            'Usuario_Areas',
            'Usuario_Ubicaciones',
            'Asistencias'
        ];

        let sqlDump = `-- =====================================================================\n`;
        sqlDump += `-- RESPALDO OFICIAL DE BASE DE DATOS: AsistenciaRH\n`;
        sqlDump += `-- Fecha y Hora: ${new Date().toISOString()}\n`;
        sqlDump += `-- Generado por: ${user.usuario || user.nombre} (ID: ${user.id_usuario})\n`;
        sqlDump += `-- Motor: Turso libSQL (SQLite)\n`;
        sqlDump += `-- =====================================================================\n\n`;
        sqlDump += `PRAGMA foreign_keys = OFF;\n`;
        sqlDump += `BEGIN TRANSACTION;\n\n`;

        let totalRecords = 0;

        for (const tableName of tables) {
            try {
                const tableData = await query(`SELECT * FROM ${tableName}`);
                const rows = tableData.recordset;
                totalRecords += rows.length;

                sqlDump += `-- ---------------------------------------------------------------------\n`;
                sqlDump += `-- Tabla: ${tableName} (${rows.length} registros)\n`;
                sqlDump += `-- ---------------------------------------------------------------------\n`;
                sqlDump += `DELETE FROM ${tableName};\n`;

                if (rows.length > 0) {
                    const columns = Object.keys(rows[0]);
                    for (const row of rows) {
                        const values = columns.map(col => {
                            const val = row[col];
                            if (val === null || val === undefined) return 'NULL';
                            if (typeof val === 'number') return val;
                            if (typeof val === 'boolean') return val ? 1 : 0;
                            const escaped = String(val).replace(/'/g, "''");
                            return `'${escaped}'`;
                        });
                        sqlDump += `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
                    }
                }
                sqlDump += `\n`;
            } catch (tabErr) {
                sqlDump += `-- Error leyendo tabla ${tableName}: ${tabErr.message}\n\n`;
            }
        }

        sqlDump += `COMMIT;\n`;
        sqlDump += `PRAGMA foreign_keys = ON;\n\n`;
        sqlDump += `-- Fin del Respaldo. Total de registros exportados: ${totalRecords}\n`;

        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="asistenciarh_backup_${timestamp}.sql"`);
        return res.send(sqlDump);

    } catch (err) {
        console.error('Error al generar respaldo SQL:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al generar respaldo de base de datos: ' + err.message
        });
    }
}

module.exports = {
    showReportes,
    exportExcel,
    exportSqlBackup
};
