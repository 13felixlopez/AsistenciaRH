const { getPool, sql } = require('../config/db');

// Obtener ubicaciones de un área en formato JSON
async function getUbicacionesByArea(req, res) {
    const { id } = req.params;
    const areaId = parseInt(id, 10);

    if (isNaN(areaId)) {
        return res.status(400).json({ success: false, message: 'ID de área no válido.' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('areaId', sql.Int, areaId)
            .query(`
                SELECT id_ubicacion, id_area, codigo, nombre, descripcion, activa, fecha_creacion
                FROM Ubicaciones
                WHERE id_area = @areaId
                ORDER BY nombre ASC
            `);

        return res.json({
            success: true,
            ubicaciones: result.recordset
        });
    } catch (err) {
        console.error('Error al obtener ubicaciones del área:', err);
        return res.status(500).json({ success: false, message: 'Error interno al consultar ubicaciones.' });
    }
}

// Crear una nueva ubicación dentro de un área
async function createUbicacion(req, res) {
    const { id_area, codigo, nombre, descripcion } = req.body;
    const areaId = parseInt(id_area, 10);

    if (isNaN(areaId) || !codigo || !nombre) {
        return res.status(400).json({ success: false, message: 'El área, código y nombre son obligatorios.' });
    }

    try {
        const pool = await getPool();
        const cleanCodigo = codigo.trim().toUpperCase();
        const cleanNombre = nombre.trim();
        const cleanDesc = descripcion ? descripcion.trim() : null;

        // Validar unicidad dentro del área
        const checkDuplicado = await pool.request()
            .input('areaId', sql.Int, areaId)
            .input('codigo', sql.VarChar, cleanCodigo)
            .input('nombre', sql.NVarChar, cleanNombre)
            .query(`
                SELECT id_ubicacion FROM Ubicaciones 
                WHERE id_area = @areaId AND (codigo = @codigo OR nombre = @nombre)
            `);

        if (checkDuplicado.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya existe una ubicación con ese código o nombre en esta área.' });
        }

        const insertRes = await pool.request()
            .input('areaId', sql.Int, areaId)
            .input('codigo', sql.VarChar, cleanCodigo)
            .input('nombre', sql.NVarChar, cleanNombre)
            .input('desc', sql.NVarChar, cleanDesc)
            .query(`
                INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion, activa)
                OUTPUT INSERTED.id_ubicacion, INSERTED.codigo, INSERTED.nombre, INSERTED.descripcion, INSERTED.activa
                VALUES (@areaId, @codigo, @nombre, @desc, 1)
            `);

        return res.status(201).json({
            success: true,
            message: `Ubicación "${cleanNombre}" creada exitosamente.`,
            ubicacion: insertRes.recordset[0]
        });
    } catch (err) {
        console.error('Error al crear ubicación:', err);
        return res.status(500).json({ success: false, message: 'Error en el servidor al crear la ubicación.' });
    }
}

// Actualizar una ubicación existente
async function updateUbicacion(req, res) {
    const { id_ubicacion, codigo, nombre, descripcion } = req.body;
    const uId = parseInt(id_ubicacion, 10);

    if (isNaN(uId) || !codigo || !nombre) {
        return res.status(400).json({ success: false, message: 'Datos incompletos para actualizar.' });
    }

    try {
        const pool = await getPool();
        const cleanCodigo = codigo.trim().toUpperCase();
        const cleanNombre = nombre.trim();
        const cleanDesc = descripcion ? descripcion.trim() : null;

        // Obtener el id_area de la ubicación
        const uActual = await pool.request()
            .input('id', sql.Int, uId)
            .query('SELECT id_area FROM Ubicaciones WHERE id_ubicacion = @id');

        if (uActual.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Ubicación no encontrada.' });
        }

        const areaId = uActual.recordset[0].id_area;

        // Verificar que no choque con otra ubicación de la misma área
        const checkDuplicado = await pool.request()
            .input('id', sql.Int, uId)
            .input('areaId', sql.Int, areaId)
            .input('codigo', sql.VarChar, cleanCodigo)
            .input('nombre', sql.NVarChar, cleanNombre)
            .query(`
                SELECT id_ubicacion FROM Ubicaciones 
                WHERE id_area = @areaId AND id_ubicacion != @id AND (codigo = @codigo OR nombre = @nombre)
            `);

        if (checkDuplicado.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya existe otra ubicación con ese código o nombre en esta área.' });
        }

        await pool.request()
            .input('id', sql.Int, uId)
            .input('codigo', sql.VarChar, cleanCodigo)
            .input('nombre', sql.NVarChar, cleanNombre)
            .input('desc', sql.NVarChar, cleanDesc)
            .query(`
                UPDATE Ubicaciones
                SET codigo = @codigo, nombre = @nombre, descripcion = @desc
                WHERE id_ubicacion = @id
            `);

        return res.json({ success: true, message: `Ubicación "${cleanNombre}" actualizada.` });
    } catch (err) {
        console.error('Error al actualizar ubicación:', err);
        return res.status(500).json({ success: false, message: 'Error interno al actualizar la ubicación.' });
    }
}

// Activar o desactivar ubicación
async function toggleUbicacion(req, res) {
    const { id } = req.params;
    const uId = parseInt(id, 10);

    if (isNaN(uId)) {
        return res.status(400).json({ success: false, message: 'ID no válido.' });
    }

    try {
        const pool = await getPool();
        const toggleRes = await pool.request()
            .input('id', sql.Int, uId)
            .query(`
                UPDATE Ubicaciones
                SET activa = CASE WHEN activa = 1 THEN 0 ELSE 1 END
                OUTPUT INSERTED.activa, INSERTED.nombre
                WHERE id_ubicacion = @id
            `);

        if (toggleRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Ubicación no encontrada.' });
        }

        const { activa, nombre } = toggleRes.recordset[0];
        const statusStr = activa ? 'activada' : 'desactivada';

        return res.json({
            success: true,
            activa,
            message: `Ubicación "${nombre}" ${statusStr} exitosamente.`
        });
    } catch (err) {
        console.error('Error al cambiar estado de ubicación:', err);
        return res.status(500).json({ success: false, message: 'Error al cambiar estado.' });
    }
}

module.exports = {
    getUbicacionesByArea,
    createUbicacion,
    updateUbicacion,
    toggleUbicacion
};
