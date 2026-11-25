const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas } = require('../middlewares/auth');
const { getLocalDateStr } = require('../services/asistenciaService');

async function showDashboard(req, res) {
    try {
        const pool = await getPool();
        const user = req.user || req.session.user;

        // Obtener áreas a las que tiene acceso
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        let totalAreas = allowedAreas.length;
        let totalPuestos = 0;
        let totalPlantilla = 0;
        let totalAsistenciasHoy = 0;
        let totalFaltantesHoy = 0;
        let rankingFaltantes = [];
        let ultimosRegistros = [];
        let graficoDias = [];

        if (areaIds.length > 0) {
            const areaIdsList = areaIds.join(',');
            const hoyLocal = getLocalDateStr();

            // Contar puestos en las áreas permitidas
            const puestosRes = await pool.request().query(`
                SELECT COUNT(*) AS total 
                FROM Puestos 
                WHERE id_area IN (${areaIdsList}) AND activo = 1
            `);
            totalPuestos = puestosRes.recordset[0].total;

            // Contar asistencias registradas hoy en las áreas permitidas (según fecha local de Nicaragua)
            const asistenciasHoyRes = await pool.request()
                .input('hoyLocal', sql.Date, hoyLocal)
                .query(`
                    SELECT ISNULL(SUM(a.cantidad_asistentes), 0) AS total_personas
                    FROM Asistencias_Diarias a
                    INNER JOIN Puestos p ON a.id_puesto = p.id_puesto
                    WHERE p.id_area IN (${areaIdsList}) AND a.fecha = @hoyLocal
                `);
            totalAsistenciasHoy = asistenciasHoyRes.recordset[0].total_personas;

            // Resumen de Áreas con Faltantes de Personal Hoy (Plantilla vs Asistencia)
            const rankingRes = await pool.request()
                .input('hoyLocal', sql.Date, hoyLocal)
                .query(`
                    SELECT 
                        ar.id_area,
                        ar.nombre AS area_nombre,
                        ar.codigo AS area_codigo,
                        ISNULL(plantilla.total_contratada, 0) AS total_contratada,
                        ISNULL(asistencia.total_asistentes, 0) AS total_asistentes
                    FROM Areas ar
                    LEFT JOIN (
                        SELECT id_area, SUM(ISNULL(cantidad_contratada, 0)) AS total_contratada
                        FROM Puestos
                        WHERE activo = 1
                        GROUP BY id_area
                    ) plantilla ON ar.id_area = plantilla.id_area
                    LEFT JOIN (
                        SELECT p.id_area, SUM(ISNULL(ad.cantidad_asistentes, 0)) AS total_asistentes
                        FROM Asistencias_Diarias ad
                        INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                        WHERE ad.fecha = @hoyLocal
                        GROUP BY p.id_area
                    ) asistencia ON ar.id_area = asistencia.id_area
                    WHERE ar.id_area IN (${areaIdsList})
                `);

            rankingFaltantes = rankingRes.recordset.map(item => {
                const contratada = item.total_contratada || 0;
                const asistentes = item.total_asistentes || 0;
                const diferencia = asistentes - contratada;
                const faltantes = contratada > 0 ? Math.max(0, contratada - asistentes) : 0;
                const porcentaje = contratada > 0 ? Math.round((asistentes / contratada) * 100) : (asistentes > 0 ? 100 : 0);
                totalPlantilla += contratada;
                totalFaltantesHoy += faltantes;
                return {
                    ...item,
                    contratada,
                    asistentes,
                    diferencia,
                    faltantes,
                    porcentaje
                };
            }).sort((a, b) => {
                if (b.faltantes !== a.faltantes) {
                    return b.faltantes - a.faltantes;
                }
                return a.porcentaje - b.porcentaje;
            });

            // Últimos 8 registros de asistencia con datos de área, ubicación y puesto
            const ultimosRes = await pool.request().query(`
                SELECT TOP 8 
                    ad.id_asistencia,
                    ad.fecha,
                    ISNULL(ad.turno, 'UNICO') AS turno,
                    ad.cantidad_asistentes,
                    ad.observaciones,
                    ad.fecha_registro,
                    FORMAT(ad.fecha_registro, 'dd/MM/yyyy hh:mm tt') AS fecha_registro_texto,
                    FORMAT(ad.fecha_registro, 'hh:mm tt') AS hora_registro_texto,
                    p.nombre AS puesto_nombre,
                    ar.nombre AS area_nombre,
                    ub.nombre AS ubicacion_nombre,
                    u.nombre AS usuario_registro
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                INNER JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                WHERE ar.id_area IN (${areaIdsList})
                ORDER BY ad.fecha DESC, ad.fecha_registro DESC
            `);
            ultimosRegistros = ultimosRes.recordset;

            // Datos para gráfico rápido de últimos 7 días
            const chartRes = await pool.request()
                .input('hoyLocal', sql.Date, hoyLocal)
                .query(`
                    SELECT 
                        CONVERT(VARCHAR(10), ad.fecha, 120) AS fecha,
                        SUM(ad.cantidad_asistentes) AS total_asistencias
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    WHERE p.id_area IN (${areaIdsList}) 
                      AND ad.fecha >= DATEADD(day, -7, @hoyLocal)
                    GROUP BY ad.fecha
                    ORDER BY ad.fecha ASC
                `);
            graficoDias = chartRes.recordset;
        }

        const porcentajeCoberturaGlobal = totalPlantilla > 0 
            ? Math.round((totalAsistenciasHoy / totalPlantilla) * 100) 
            : 100;

        return res.json({
            success: true,
            data: {
                totalAreas,
                totalPuestos,
                totalPlantilla,
                totalAsistenciasHoy,
                totalFaltantesHoy,
                porcentajeCoberturaGlobal,
                allowedAreas,
                rankingFaltantes,
                ultimosRegistros,
                graficoDias
            }
        });
    } catch (err) {
        console.error('Error al cargar dashboard:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar el panel de control.',
            data: {
                totalAreas: 0,
                totalPuestos: 0,
                totalAsistenciasHoy: 0,
                allowedAreas: [],
                ultimosRegistros: [],
                graficoDias: []
            }
        });
    }
}

module.exports = {
    showDashboard
};
