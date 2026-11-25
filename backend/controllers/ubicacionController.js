const { query } = require('../config/db');

// Obtener ubicaciones de un área en formato JSON
async function getUbicacionesByArea(req, res) {
    const { id } = req.params;
    const areaId = parseInt(id, 10);

    if (isNaN(areaId)) {
        return res.status(400).json({ success: false, message: 'ID de área no válido.' });
    }

    try {
        const result = await query(`
            SELECT id_ubicacion, id_area, codigo, nombre, descripcion, activa, fecha_creacion
            FROM Ubicaciones
            WHERE id_area = ?
            ORDER BY nombre ASC
        `, [areaId]);

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
        const cleanCodigo = codigo.trim().toUpperCase();
        const cleanNombre = nombre.trim();
        const cleanDesc = descripcion ? descripcion.trim() : null;

        const checkDuplicado = await query(`
            SELECT id_ubicacion FROM Ubicaciones 
            WHERE id_area = ? AND (codigo = ? OR nombre = ?)
        `, [areaId, cleanCodigo, cleanNombre]);

        if (checkDuplicado.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya existe una ubicación con ese código o nombre en esta área.' });
        }

        const insertRes = await query(`
            INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion, activa)
            VALUES (?, ?, ?, ?, 1)
            RETURNING id_ubicacion, codigo, nombre, descripcion, activa
        `, [areaId, cleanCodigo, cleanNombre, cleanDesc]);

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
        const cleanCodigo = codigo.trim().toUpperCase();
        const cleanNombre = nombre.trim();
        const cleanDesc = descripcion ? descripcion.trim() : null;

        const uActual = await query('SELECT id_area FROM Ubicaciones WHERE id_ubicacion = ?', [uId]);

        if (uActual.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Ubicación no encontrada.' });
        }

        const areaId = uActual.recordset[0].id_area;

        const checkDuplicado = await query(`
            SELECT id_ubicacion FROM Ubicaciones 
            WHERE id_area = ? AND id_ubicacion != ? AND (codigo = ? OR nombre = ?)
        `, [areaId, uId, cleanCodigo, cleanNombre]);

        if (checkDuplicado.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya existe otra ubicación con ese código o nombre en esta área.' });
        }

        await query(`
            UPDATE Ubicaciones
            SET codigo = ?, nombre = ?, descripcion = ?
            WHERE id_ubicacion = ?
        `, [cleanCodigo, cleanNombre, cleanDesc, uId]);

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
        const toggleRes = await query(`
            UPDATE Ubicaciones
            SET activa = CASE WHEN activa = 1 THEN 0 ELSE 1 END
            WHERE id_ubicacion = ?
            RETURNING activa, nombre
        `, [uId]);

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
