const { sql, getPool } = require('../config/db');

// Obtener fecha local en formato YYYY-MM-DD
function getLocalDateStr(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Autocompleta con 0 cualquier puesto/turno activo que haya quedado NULL/vacío
 * exclusivamente para fechas estrictamente anteriores a la fecha local actual (hoy).
 * 
 * @param {string} [fechaEspecifica] Fecha en formato YYYY-MM-DD (debe ser menor a hoy local)
 * @param {number} [idArea] Opcional: restringir al área indicada
 * @returns {Promise<number>} Cantidad de registros autocompletados
 */
async function autocompletarAsistenciasPasadas(fechaEspecifica = null, idArea = null) {
    try {
        const pool = await getPool();
        const hoyLocal = getLocalDateStr();

        // Obtener el ID de un usuario administrador o del sistema para firmar el autocompletado
        const adminRes = await pool.request().query(`
            SELECT TOP 1 id_usuario FROM Usuarios 
            WHERE id_rol = (SELECT id_rol FROM Roles WHERE codigo = 'ADMIN')
            ORDER BY id_usuario ASC
        `);
        const idAdmin = adminRes.recordset.length > 0 ? adminRes.recordset[0].id_usuario : 1;

        // Validación estricta con la fecha local del sistema (evitando desfase horario UTC de SQL Server)
        let queryCondition = '';
        if (fechaEspecifica) {
            queryCondition = `AND f.fecha = @fechaParam AND f.fecha < @fechaHoyLocal`;
        } else {
            // Solo fechas que ya concluyeron (estrictamente anteriores al día de hoy local)
            queryCondition = `AND f.fecha < @fechaHoyLocal AND f.fecha >= DATEADD(day, -30, @fechaHoyLocal)`;
        }

        const areaCondition = idArea ? `AND p.id_area = @areaId` : '';

        const request = pool.request();
        request.input('adminId', sql.Int, idAdmin);
        request.input('fechaHoyLocal', sql.Date, hoyLocal);
        if (fechaEspecifica) {
            request.input('fechaParam', sql.Date, fechaEspecifica);
        }
        if (idArea) {
            request.input('areaId', sql.Int, idArea);
        }

        // Consulta atómica que inserta los slots faltantes en 0
        const result = await request.query(`
            -- Identificar fechas a evaluar
            WITH FechasAEvaluar AS (
                SELECT DISTINCT fecha
                FROM Asistencias_Diarias f
                WHERE 1 = 1 ${queryCondition}
            ),
            SlotsRequeridos AS (
                -- Para puestos normales (aplica_turnos = 0): turno UNICO
                SELECT 
                    f.fecha,
                    p.id_puesto,
                    'UNICO' AS turno
                FROM FechasAEvaluar f
                CROSS JOIN Puestos p
                WHERE p.activo = 1 ${areaCondition} AND ISNULL(p.aplica_turnos, 0) = 0

                UNION ALL

                -- Para puestos con turnos (aplica_turnos = 1): TURNO_1
                SELECT 
                    f.fecha,
                    p.id_puesto,
                    'TURNO_1' AS turno
                FROM FechasAEvaluar f
                CROSS JOIN Puestos p
                WHERE p.activo = 1 ${areaCondition} AND ISNULL(p.aplica_turnos, 0) = 1

                UNION ALL

                -- Para puestos con turnos (aplica_turnos = 1): TURNO_2
                SELECT 
                    f.fecha,
                    p.id_puesto,
                    'TURNO_2' AS turno
                FROM FechasAEvaluar f
                CROSS JOIN Puestos p
                WHERE p.activo = 1 ${areaCondition} AND ISNULL(p.aplica_turnos, 0) = 1
            )
            INSERT INTO Asistencias_Diarias (
                fecha, 
                id_puesto, 
                turno, 
                cantidad_asistentes, 
                observaciones, 
                id_usuario_registro, 
                fecha_registro
            )
            SELECT 
                sr.fecha,
                sr.id_puesto,
                sr.turno,
                0,
                N'Cierre automático de jornada (0 asistentes)',
                @adminId,
                GETDATE()
            FROM SlotsRequeridos sr
            WHERE NOT EXISTS (
                SELECT 1 
                FROM Asistencias_Diarias ad
                WHERE ad.fecha = sr.fecha 
                  AND ad.id_puesto = sr.id_puesto 
                  AND ad.turno = sr.turno
            );
        `);

        const registrosInsertados = result.rowsAffected[0] || 0;
        if (registrosInsertados > 0) {
            console.log(`ℹ️ [Autocompletado] Se autocompletaron ${registrosInsertados} puestos/turnos con 0 en fecha(s) pasada(s).`);
        }
        return registrosInsertados;
    } catch (err) {
        console.error('Error al autocompletar asistencias pasadas:', err.message);
        return 0;
    }
}

module.exports = {
    autocompletarAsistenciasPasadas
};
