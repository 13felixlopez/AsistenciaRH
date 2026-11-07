const { getPool, sql } = require('../config/db');

// Listar puestos (opcionalmente filtrados por área)
async function listPuestos(req, res) {
    const areaFilter = req.query.areaId ? parseInt(req.query.areaId, 10) : null;

    try {
        const pool = await getPool();

        // Obtener todas las áreas activas para el selector de filtro
        const areasRes = await pool.request().query('SELECT id_area, nombre FROM Areas WHERE activa = 1 ORDER BY nombre ASC');

        let query = `
            SELECT 
                p.id_puesto,
                p.nombre AS puesto_nombre,
                p.descripcion AS puesto_descripcion,
                ISNULL(p.aplica_turnos, 0) AS aplica_turnos,
                p.activo,
                p.fecha_creacion,
                a.id_area,
                a.nombre AS area_nombre,
                a.codigo AS area_codigo
            FROM Puestos p
            INNER JOIN Areas a ON p.id_area = a.id_area
        `;

        if (areaFilter) {
            query += ` WHERE p.id_area = ${areaFilter}`;
        }
        query += ` ORDER BY a.nombre ASC, p.nombre ASC`;

        const puestosRes = await pool.request().query(query);

        return res.json({
            success: true,
            puestos: puestosRes.recordset,
            areas: areasRes.recordset,
            selectedAreaId: areaFilter
        });
    } catch (err) {
        console.error('Error al listar puestos:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar los puestos.'
        });
    }
}

// Crear puesto
async function createPuesto(req, res) {
    const { id_area, nombre, descripcion, aplica_turnos } = req.body;

    if (!id_area || !nombre) {
        return res.status(400).json({
            success: false,
            message: 'Debe seleccionar un área y especificar el nombre del puesto.'
        });
    }

    const turnosBit = (aplica_turnos === '1' || aplica_turnos === 'true' || aplica_turnos === true || aplica_turnos === 'on') ? 1 : 0;

    try {
        const pool = await getPool();

        // Verificar duplicado en la misma área
        const check = await pool.request()
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .query('SELECT id_puesto FROM Puestos WHERE id_area = @id_area AND nombre = @nombre');

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe un puesto con el nombre "${nombre}" en el área seleccionada.`
            });
        }

        const insertRes = await pool.request()
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .input('aplica_turnos', sql.Bit, turnosBit)
            .query(`
                INSERT INTO Puestos (id_area, nombre, descripcion, aplica_turnos, activo)
                OUTPUT INSERTED.id_puesto
                VALUES (@id_area, @nombre, @descripcion, @aplica_turnos, 1)
            `);

        return res.status(201).json({
            success: true,
            message: `Puesto "${nombre}" creado exitosamente.`,
            id_puesto: insertRes.recordset[0].id_puesto
        });
    } catch (err) {
        console.error('Error al crear puesto:', err);
        return res.status(500).json({
            success: false,
            message: 'No se pudo crear el puesto.'
        });
    }
}

// Editar puesto
async function updatePuesto(req, res) {
    const { id_puesto, id_area, nombre, descripcion, aplica_turnos, activo } = req.body;

    if (!id_puesto || !id_area || !nombre) {
        return res.status(400).json({
            success: false,
            message: 'Datos incompletos para actualizar el puesto.'
        });
    }

    const turnosBit = (aplica_turnos === '1' || aplica_turnos === 'true' || aplica_turnos === true || aplica_turnos === 'on') ? 1 : 0;

    try {
        const pool = await getPool();

        // Validar unicidad en el área excluyendo el actual
        const check = await pool.request()
            .input('id_puesto', sql.Int, id_puesto)
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .query('SELECT id_puesto FROM Puestos WHERE id_area = @id_area AND nombre = @nombre AND id_puesto != @id_puesto');

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe un puesto con el nombre "${nombre}" en dicha área.`
            });
        }

        await pool.request()
            .input('id_puesto', sql.Int, id_puesto)
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .input('aplica_turnos', sql.Bit, turnosBit)
            .input('activo', sql.Bit, activo ? 1 : 0)
            .query(`
                UPDATE Puestos
                SET id_area = @id_area,
                    nombre = @nombre,
                    descripcion = @descripcion,
                    aplica_turnos = @aplica_turnos,
                    activo = @activo
                WHERE id_puesto = @id_puesto
            `);

        return res.json({
            success: true,
            message: `Puesto "${nombre}" actualizado correctamente.`
        });
    } catch (err) {
        console.error('Error al actualizar puesto:', err);
        return res.status(500).json({
            success: false,
            message: 'No se pudo modificar el puesto.'
        });
    }
}

// Activar o desactivar puesto
async function togglePuestoStatus(req, res) {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Puestos SET activo = ~activo OUTPUT INSERTED.activo WHERE id_puesto = @id');

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Puesto no encontrado.' });
        }

        return res.json({
            success: true,
            message: 'Estado del puesto actualizado.',
            activo: result.recordset[0].activo
        });
    } catch (err) {
        console.error('Error al alternar estado del puesto:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al modificar el estado.'
        });
    }
}

// API: Obtener puestos por ID de área (para carga dinámica en frontend)
async function getPuestosByArea(req, res) {
    const { areaId } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('areaId', sql.Int, areaId)
            .query(`
                SELECT id_puesto, id_area, nombre, descripcion, ISNULL(aplica_turnos, 0) AS aplica_turnos, activo
                FROM Puestos
                WHERE id_area = @areaId AND activo = 1
                ORDER BY nombre ASC
            `);

        return res.json({ success: true, puestos: result.recordset });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

// API: Obtener un puesto específico para edición
async function getPuestoById(req, res) {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id_puesto, id_area, nombre, descripcion, ISNULL(aplica_turnos, 0) AS aplica_turnos, activo FROM Puestos WHERE id_puesto = @id');

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Puesto no encontrado' });
        }
        return res.json({ success: true, puesto: result.recordset[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    listPuestos,
    createPuesto,
    updatePuesto,
    togglePuestoStatus,
    getPuestosByArea,
    getPuestoById
};
