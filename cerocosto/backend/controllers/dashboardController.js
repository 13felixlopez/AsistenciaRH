const { query } = require('../config/db');
const { getUserAllowedAreas } = require('../middlewares/auth');
const { getLocalDateStr } = require('../services/asistenciaService');

async function showDashboard(req, res) {
    try {
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
            const placeholders = areaIds.map(() => '?').join(',');
            const hoyLocal = getLocalDateStr();

            // Contar puestos en las áreas permitidas
            const puestosRes = await query(`
                SELECT COUNT(*) AS total 
                FROM Puestos 
                WHERE id_area IN (${placeholders}) AND activo = 1
            `, areaIds);
            totalPuestos = puestosRes.recordset[0]?.total || 0;

            // Contar asistencias registradas hoy en las áreas permitidas (según fecha local de Nicaragua)
            const asistenciasHoyRes = await query(`
                SELECT COALESCE(SUM(a.cantidad_asistentes), 0) AS total_personas
                FROM Asistencias_Diarias a
                INNER JOIN Puestos p ON a.id_puesto = p.id_puesto
                WHERE p.id_area IN (${placeholders}) AND a.fecha = ?
            `, [...areaIds, hoyLocal]);
            totalAsistenciasHoy = asistenciasHoyRes.recordset[0]?.total_personas || 0;

            // Resumen de Áreas con Faltantes de Personal Hoy (Plantilla vs Asistencia)
            const rankingRes = await query(`
                SELECT 
                    ar.id_area,
                    ar.nombre AS area_nombre,
                    ar.codigo AS area_codigo,
                    COALESCE(plantilla.total_contratada, 0) AS total_contratada,
                    COALESCE(asistencia.total_asistentes, 0) AS total_asistentes
                FROM Areas ar
                LEFT JOIN (
                    SELECT id_area, SUM(COALESCE(cantidad_contratada, 0)) AS total_contratada
                    FROM Puestos
                    WHERE activo = 1
                    GROUP BY id_area
                ) plantilla ON ar.id_area = plantilla.id_area
                LEFT JOIN (
                    SELECT p.id_area, SUM(COALESCE(ad.cantidad_asistentes, 0)) AS total_asistentes
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    WHERE ad.fecha = ?
                    GROUP BY p.id_area
                ) asistencia ON ar.id_area = asistencia.id_area
                WHERE ar.id_area IN (${placeholders})
            `, [hoyLocal, ...areaIds]);

            rankingFaltantes = (rankingRes.recordset || []).map(item => {
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

            // Últimos 8 registros de asistencia
            const ultimosRes = await query(`
                SELECT 
                    ad.id_asistencia,
                    ad.fecha,
                    COALESCE(ad.turno, 'UNICO') AS turno,
                    ad.cantidad_asistentes,
                    ad.observaciones,
                    ad.fecha_registro,
                    strftime('%d/%m/%Y %H:%M', ad.fecha_registro) AS fecha_registro_texto,
                    strftime('%H:%M', ad.fecha_registro) AS hora_registro_texto,
                    p.nombre AS puesto_nombre,
                    ar.nombre AS area_nombre,
                    ub.nombre AS ubicacion_nombre,
                    u.nombre AS usuario_registro
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                WHERE ar.id_area IN (${placeholders})
                ORDER BY ad.fecha DESC, ad.fecha_registro DESC
                LIMIT 8
            `, areaIds);
            ultimosRegistros = ultimosRes.recordset;

            // Datos para gráfico de los últimos 7 días
            const sieteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const fechaMin = getLocalDateStr(sieteDiasAtras);
            const chartRes = await query(`
                SELECT 
                    ad.fecha AS fecha,
                    SUM(ad.cantidad_asistentes) AS total_asistencias
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                WHERE p.id_area IN (${placeholders}) 
                  AND ad.fecha >= ?
                GROUP BY ad.fecha
                ORDER BY ad.fecha ASC
            `, [...areaIds, fechaMin]);
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
            message: 'Error al cargar el panel de control: ' + err.message,
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
