const { getPool, sql } = require('../config/db');

// Listar todas las áreas
async function listAreas(req, res) {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
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
        const pool = await getPool();
        // Verificar duplicados de código
        const check = await pool.request()
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .query('SELECT id_area FROM Areas WHERE codigo = @codigo');

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe un área con el código ${codigo.trim().toUpperCase()}.`
            });
        }

        const insertRes = await pool.request()
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .query(`
                INSERT INTO Areas (codigo, nombre, descripcion, activa)
                OUTPUT INSERTED.id_area
                VALUES (@codigo, @nombre, @descripcion, 1)
            `);

        return res.status(201).json({
            success: true,
            message: `Área "${nombre}" creada exitosamente.`,
            id_area: insertRes.recordset[0].id_area
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
        const pool = await getPool();

        // Verificar código único exceptuando la actual
        const check = await pool.request()
            .input('id', sql.Int, id_area)
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .query('SELECT id_area FROM Areas WHERE codigo = @codigo AND id_area != @id');

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe otra área con el código ${codigo.trim().toUpperCase()}.`
            });
        }

        await pool.request()
            .input('id', sql.Int, id_area)
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .input('activa', sql.Bit, activa ? 1 : 0)
            .query(`
                UPDATE Areas 
                SET codigo = @codigo,
                    nombre = @nombre,
                    descripcion = @descripcion,
                    activa = @activa
                WHERE id_area = @id
            `);

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
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Areas SET activa = ~activa OUTPUT INSERTED.activa WHERE id_area = @id');

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
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id_area, codigo, nombre, descripcion, activa FROM Areas WHERE id_area = @id');

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
