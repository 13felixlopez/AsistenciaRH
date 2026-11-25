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

        res.render('areas/index', {
            title: 'Gestión de Áreas | Registro de Asistencia',
            areas: result.recordset,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al listar áreas:', err);
        req.flash('error', 'Error al cargar las áreas.');
        res.redirect('/dashboard');
    }
}

// Crear nueva área
async function createArea(req, res) {
    const { codigo, nombre, descripcion } = req.body;

    if (!codigo || !nombre) {
        req.flash('error', 'El código y el nombre del área son obligatorios.');
        return res.redirect('/areas');
    }

    try {
        const pool = await getPool();
        // Verificar duplicados de código
        const check = await pool.request()
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .query('SELECT id_area FROM Areas WHERE codigo = @codigo');

        if (check.recordset.length > 0) {
            req.flash('error', `Ya existe un área con el código ${codigo.trim().toUpperCase()}.`);
            return res.redirect('/areas');
        }

        await pool.request()
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .query(`
                INSERT INTO Areas (codigo, nombre, descripcion, activa)
                VALUES (@codigo, @nombre, @descripcion, 1)
            `);

        req.flash('success', `Área "${nombre}" creada exitosamente.`);
        res.redirect('/areas');
    } catch (err) {
        console.error('Error al crear área:', err);
        req.flash('error', 'No se pudo crear el área. Verifique los datos.');
        res.redirect('/areas');
    }
}

// Editar área
async function updateArea(req, res) {
    const { id_area, codigo, nombre, descripcion, activa } = req.body;

    if (!id_area || !codigo || !nombre) {
        req.flash('error', 'Datos incompletos para actualizar el área.');
        return res.redirect('/areas');
    }

    try {
        const pool = await getPool();

        // Verificar código único exceptuando la actual
        const check = await pool.request()
            .input('id', sql.Int, id_area)
            .input('codigo', sql.VarChar, codigo.trim().toUpperCase())
            .query('SELECT id_area FROM Areas WHERE codigo = @codigo AND id_area != @id');

        if (check.recordset.length > 0) {
            req.flash('error', `Ya existe otra área con el código ${codigo.trim().toUpperCase()}.`);
            return res.redirect('/areas');
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

        req.flash('success', `Área "${nombre}" actualizada correctamente.`);
        res.redirect('/areas');
    } catch (err) {
        console.error('Error al actualizar área:', err);
        req.flash('error', 'Error al modificar el área.');
        res.redirect('/areas');
    }
}

// Cambiar estado activo/inactivo
async function toggleAreaStatus(req, res) {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Areas SET activa = ~activa WHERE id_area = @id');

        req.flash('success', 'Estado del área modificado correctamente.');
        res.redirect('/areas');
    } catch (err) {
        console.error('Error al alternar estado del área:', err);
        req.flash('error', 'No se pudo cambiar el estado del área.');
        res.redirect('/areas');
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
        res.json({ success: true, area: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    listAreas,
    createArea,
    updateArea,
    toggleAreaStatus,
    getAreaById
};
