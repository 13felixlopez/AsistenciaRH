const { getPool, sql } = require('../config/db');

// Obtener ubicaciones de un área en formato JSON (para API y modales)
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
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(400).json({ success: false, message: 'El área, código y nombre son obligatorios.' });
        }
        req.flash('error', 'El código y el nombre de la ubicación son obligatorios.');
        return res.redirect('/areas');
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
            const msg = `Ya existe una ubicación con ese código o nombre en esta área.`;
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(400).json({ success: false, message: msg });
            }
            req.flash('error', msg);
            return res.redirect('/areas');
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

        const nuevaUbicacion = insertRes.recordset[0];

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({
                success: true,
                message: `Ubicación "${cleanNombre}" creada exitosamente.`,
                ubicacion: nuevaUbicacion
            });
        }

        req.flash('success', `Ubicación "${cleanNombre}" agregada exitosamente.`);
        return res.redirect('/areas');
    } catch (err) {
        console.error('Error al crear ubicación:', err);
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(500).json({ success: false, message: 'Error en el servidor al crear la ubicación.' });
        }
        req.flash('error', 'Error al crear la ubicación: ' + err.message);
        return res.redirect('/areas');
    }
}

// Actualizar una ubicación existente
async function updateUbicacion(req, res) {
    const { id_ubicacion, codigo, nombre, descripcion } = req.body;
    const uId = parseInt(id_ubicacion, 10);

    if (isNaN(uId) || !codigo || !nombre) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(400).json({ success: false, message: 'Datos incompletos para actualizar.' });
        }
        req.flash('error', 'Código y nombre son obligatorios.');
        return res.redirect('/areas');
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
            const msg = 'Ya existe otra ubicación con ese código o nombre en esta área.';
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(400).json({ success: false, message: msg });
            }
            req.flash('error', msg);
            return res.redirect('/areas');
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

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({ success: true, message: `Ubicación "${cleanNombre}" actualizada.` });
        }

        req.flash('success', `Ubicación "${cleanNombre}" actualizada exitosamente.`);
        return res.redirect('/areas');
    } catch (err) {
        console.error('Error al actualizar ubicación:', err);
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(500).json({ success: false, message: 'Error interno al actualizar la ubicación.' });
        }
        req.flash('error', 'Error al actualizar ubicación: ' + err.message);
        return res.redirect('/areas');
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

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({
                success: true,
                activa,
                message: `Ubicación "${nombre}" ${statusStr} exitosamente.`
            });
        }

        req.flash('success', `Ubicación "${nombre}" ${statusStr} exitosamente.`);
        return res.redirect('/areas');
    } catch (err) {
        console.error('Error al cambiar estado de ubicación:', err);
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(500).json({ success: false, message: 'Error al cambiar estado.' });
        }
        req.flash('error', 'Error al cambiar estado: ' + err.message);
        return res.redirect('/areas');
    }
}

module.exports = {
    getUbicacionesByArea,
    createUbicacion,
    updateUbicacion,
    toggleUbicacion
};
