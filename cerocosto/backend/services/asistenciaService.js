const { query } = require('../config/db');

// Obtener fecha local en formato YYYY-MM-DD
function getLocalDateStr(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Autocompleta con 0 cualquier puesto/turno activo que haya quedado vacío
 * exclusivamente para fechas estrictamente anteriores a la fecha local actual (hoy).
 */
async function autocompletarAsistenciasPasadas(fechaEspecifica = null, idArea = null) {
    try {
        const hoyLocal = getLocalDateStr();

        // Obtener el ID de un usuario administrador o del sistema para firmar el autocompletado
        const adminRes = await query(`
            SELECT id_usuario FROM Usuarios 
            WHERE id_rol = (SELECT id_rol FROM Roles WHERE codigo = 'ADMIN')
            ORDER BY id_usuario ASC LIMIT 1
        `);
        const idAdmin = adminRes.recordset.length > 0 ? adminRes.recordset[0].id_usuario : 1;

        let queryCondition = '';
        const params = [idAdmin];

        if (fechaEspecifica) {
            queryCondition = `AND f.fecha = ? AND f.fecha < ?`;
            params.push(fechaEspecifica, hoyLocal);
        } else {
            queryCondition = `AND f.fecha < ? AND f.fecha >= date(?, '-30 days')`;
            params.push(hoyLocal, hoyLocal);
        }

        let areaCondition = '';
        if (idArea) {
            areaCondition = `AND p.id_area = ?`;
            params.push(idArea);
        }

        const sql = `
            WITH FechasAEvaluar AS (
                SELECT DISTINCT fecha
                FROM Asistencias_Diarias f
                WHERE 1 = 1 ${queryCondition}
            ),
            SlotsRequeridos AS (
                SELECT 
                    f.fecha,
                    p.id_puesto,
                    'UNICO' AS turno
                FROM FechasAEvaluar f
                CROSS JOIN Puestos p
                WHERE p.activo = 1 ${areaCondition} AND COALESCE(p.aplica_turnos, 0) = 0

                UNION ALL

                SELECT 
                    f.fecha,
                    p.id_puesto,
                    'TURNO_1' AS turno
                FROM FechasAEvaluar f
                CROSS JOIN Puestos p
                WHERE p.activo = 1 ${areaCondition} AND COALESCE(p.aplica_turnos, 0) = 1

                UNION ALL

                SELECT 
                    f.fecha,
                    p.id_puesto,
                    'TURNO_2' AS turno
                FROM FechasAEvaluar f
                CROSS JOIN Puestos p
                WHERE p.activo = 1 ${areaCondition} AND COALESCE(p.aplica_turnos, 0) = 1
            )
            INSERT OR IGNORE INTO Asistencias_Diarias (
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
                'Cierre automático de jornada (0 asistentes)',
                ?,
                datetime('now', 'localtime')
            FROM SlotsRequeridos sr
            WHERE NOT EXISTS (
                SELECT 1 
                FROM Asistencias_Diarias ad
                WHERE ad.fecha = sr.fecha 
                  AND ad.id_puesto = sr.id_puesto 
                  AND ad.turno = sr.turno
            )
        `;

        // Agregar el idAdmin como último parámetro para el INSERT SELECT
        params.push(idAdmin);

        const result = await query(sql, params);
        const registrosInsertados = result.rowsAffected || 0;
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
    autocompletarAsistenciasPasadas,
    getLocalDateStr
};
