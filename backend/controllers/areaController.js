const { query } = require('../config/db');

// Listar todas las áreas
async function listAreas(req, res) {
    try {
        const result = await query(`
            SELECT 
                a.id_area,
                a.codigo,
                a.nombre,
                a.descripcion,
                a.activa,
                a.fecha_creacion,
                (SELECT COUNT(*) FROM Puestos p WHERE p.id_area = a.id_area AND p.activo = 1) AS total_puestos,
                (SELECT COUNT(*) FROM Ubicaciones u WHERE u.id_area = a.id_area AND u.activa = 1) AS total_ubicaciones
            FROM Areas a
            ORDER BY a.nombre ASC
        `);

        return res.json({
            success: true,
            areas: result.recordset
        });
    } catch (err) {
        console.error('Error al listar áreas:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar las áreas.'
        });
    }
}

// Crear nueva área
async function createArea(req, res) {
    const { codigo, nombre, descripcion } = req.body;

    if (!codigo || !nombre) {
        return res.status(400).json({
            success: false,
            message: 'El código y el nombre del área son obligatorios.'
        });
    }

    try {
        const cleanCodigo = codigo.trim().toUpperCase();
        const check = await query('SELECT id_area FROM Areas WHERE codigo = ?', [cleanCodigo]);

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe un área con el código ${cleanCodigo}.`
            });
        }

        const insertRes = await query(`
            INSERT INTO Areas (codigo, nombre, descripcion, activa)
            VALUES (?, ?, ?, 1)
            RETURNING id_area
        `, [cleanCodigo, nombre.trim(), descripcion ? descripcion.trim() : null]);

        return res.status(201).json({
            success: true,
            message: `Área "${nombre}" creada exitosamente.`,
            id_area: insertRes.recordset[0]?.id_area || insertRes.lastInsertRowid
        });
    } catch (err) {
        console.error('Error al crear área:', err);
        return res.status(500).json({
            success: false,
            message: 'No se pudo crear el área. Verifique los datos.'
        });
    }
}

// Editar área
async function updateArea(req, res) {
    const { id_area, codigo, nombre, descripcion, activa } = req.body;

    if (!id_area || !codigo || !nombre) {
        return res.status(400).json({
            success: false,
            message: 'Datos incompletos para actualizar el área.'
        });
    }

    try {
        const cleanCodigo = codigo.trim().toUpperCase();
        const check = await query('SELECT id_area FROM Areas WHERE codigo = ? AND id_area != ?', [cleanCodigo, id_area]);

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe otra área con el código ${cleanCodigo}.`
            });
        }

        await query(`
            UPDATE Areas 
            SET codigo = ?,
                nombre = ?,
                descripcion = ?,
                activa = ?
            WHERE id_area = ?
        `, [cleanCodigo, nombre.trim(), descripcion ? descripcion.trim() : null, activa ? 1 : 0, id_area]);

        return res.json({
            success: true,
            message: `Área "${nombre}" actualizada correctamente.`
        });
    } catch (err) {
        console.error('Error al actualizar área:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al modificar el área.'
        });
    }
}

// Cambiar estado activo/inactivo
async function toggleAreaStatus(req, res) {
    const { id } = req.params;
    try {
        const result = await query(`
            UPDATE Areas 
            SET activa = CASE WHEN activa = 1 THEN 0 ELSE 1 END 
            WHERE id_area = ? 
            RETURNING activa
        `, [id]);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Área no encontrada.' });
        }

        return res.json({
            success: true,
            message: 'Estado del área modificado correctamente.',
            activa: result.recordset[0].activa
        });
    } catch (err) {
        console.error('Error al alternar estado del área:', err);
        return res.status(500).json({
            success: false,
            message: 'No se pudo cambiar el estado del área.'
        });
    }
}

// Endpoint API para obtener datos de un área
async function getAreaById(req, res) {
    try {
        const result = await query('SELECT id_area, codigo, nombre, descripcion, activa FROM Areas WHERE id_area = ?', [req.params.id]);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Área no encontrada' });
        }
        return res.json({ success: true, area: result.recordset[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    listAreas,
    createArea,
    updateArea,
    toggleAreaStatus,
    getAreaById
};
