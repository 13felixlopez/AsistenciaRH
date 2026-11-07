const { query } = require('../config/db');
const { getUserAllowedAreas } = require('../middlewares/auth');

async function showDashboard(req, res) {
    try {
        const user = req.user || req.session.user;

        // Obtener áreas a las que tiene acceso
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        let totalAreas = allowedAreas.length;
        let totalPuestos = 0;
        let totalAsistenciasHoy = 0;
        let ultimosRegistros = [];

        if (areaIds.length > 0) {
            const placeholders = areaIds.map(() => '?').join(',');

            // Contar puestos en las áreas permitidas
            const puestosRes = await query(`
                SELECT COUNT(*) AS total 
                FROM Puestos 
                WHERE id_area IN (${placeholders}) AND activo = 1
            `, areaIds);
            totalPuestos = puestosRes.recordset[0]?.total || 0;

            // Contar asistencias registradas hoy en las áreas permitidas
            const asistenciasHoyRes = await query(`
                SELECT COALESCE(SUM(a.cantidad_asistentes), 0) AS total_personas
                FROM Asistencias_Diarias a
                INNER JOIN Puestos p ON a.id_puesto = p.id_puesto
                WHERE p.id_area IN (${placeholders}) AND a.fecha = date('now', 'localtime')
            `, areaIds);
            totalAsistenciasHoy = asistenciasHoyRes.recordset[0]?.total_personas || 0;

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
        }

        // Datos para gráfico de los últimos 7 días
        let graficoDias = [];
        if (areaIds.length > 0) {
            const placeholders = areaIds.map(() => '?').join(',');
            const chartRes = await query(`
                SELECT 
                    ad.fecha AS fecha,
                    SUM(ad.cantidad_asistentes) AS total_asistencias
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                WHERE p.id_area IN (${placeholders}) 
                  AND ad.fecha >= date('now', 'localtime', '-7 days')
                GROUP BY ad.fecha
                ORDER BY ad.fecha ASC
            `, areaIds);
            graficoDias = chartRes.recordset;
        }

        return res.json({
            success: true,
            data: {
                totalAreas,
                totalPuestos,
                totalAsistenciasHoy,
                allowedAreas,
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
