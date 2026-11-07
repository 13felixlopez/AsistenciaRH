const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas } = require('../middlewares/auth');

async function showDashboard(req, res) {
    try {
        const pool = await getPool();
        const user = req.session.user;

        // Obtener áreas a las que tiene acceso
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        let totalAreas = allowedAreas.length;
        let totalPuestos = 0;
        let totalAsistenciasHoy = 0;
        let ultimosRegistros = [];

        if (areaIds.length > 0) {
            const areaIdsList = areaIds.join(',');

            // Contar puestos en las áreas permitidas
            const puestosRes = await pool.request().query(`
                SELECT COUNT(*) AS total 
                FROM Puestos 
                WHERE id_area IN (${areaIdsList}) AND activo = 1
            `);
            totalPuestos = puestosRes.recordset[0].total;

            // Contar asistencias registradas hoy en las áreas permitidas
            const asistenciasHoyRes = await pool.request().query(`
                SELECT ISNULL(SUM(a.cantidad_asistentes), 0) AS total_personas
                FROM Asistencias_Diarias a
                INNER JOIN Puestos p ON a.id_puesto = p.id_puesto
                WHERE p.id_area IN (${areaIdsList}) AND a.fecha = CAST(GETDATE() AS DATE)
            `);
            totalAsistenciasHoy = asistenciasHoyRes.recordset[0].total_personas;

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
        }

        // Datos para gráfico rápido de últimos 7 días
        let graficoDias = [];
        if (areaIds.length > 0) {
            const areaIdsList = areaIds.join(',');
            const chartRes = await pool.request().query(`
                SELECT 
                    ad.fecha,
                    SUM(ad.cantidad_asistentes) AS total_asistencias
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                WHERE p.id_area IN (${areaIdsList}) 
                  AND ad.fecha >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
                GROUP BY ad.fecha
                ORDER BY ad.fecha ASC
            `);
            graficoDias = chartRes.recordset;
        }

        res.render('dashboard/index', {
            title: 'Panel Principal | Registro de Asistencia',
            totalAreas,
            totalPuestos,
            totalAsistenciasHoy,
            allowedAreas,
            ultimosRegistros,
            graficoDias,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al cargar dashboard:', err);
        req.flash('error', 'Error al cargar el panel de control.');
        res.render('dashboard/index', {
            title: 'Panel Principal | Registro de Asistencia',
            totalAreas: 0,
            totalPuestos: 0,
            totalAsistenciasHoy: 0,
            allowedAreas: [],
            ultimosRegistros: [],
            graficoDias: [],
            error: ['Error de conexión a la base de datos.'],
            success: []
        });
    }
}

module.exports = {
    showDashboard
};
