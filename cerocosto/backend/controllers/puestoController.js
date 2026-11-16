const { query } = require('../config/db');

// Listar puestos (opcionalmente filtrados por área)
async function listPuestos(req, res) {
    const areaFilter = req.query.areaId ? parseInt(req.query.areaId, 10) : null;

    try {
        const areasRes = await query('SELECT id_area, nombre FROM Areas WHERE activa = 1 ORDER BY nombre ASC');

        let sql = `
            SELECT 
                p.id_puesto,
                p.nombre AS puesto_nombre,
                p.descripcion AS puesto_descripcion,
                COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
                p.activo,
                p.fecha_creacion,
                a.id_area,
                a.nombre AS area_nombre,
                a.codigo AS area_codigo
            FROM Puestos p
            INNER JOIN Areas a ON p.id_area = a.id_area
        `;
        const params = [];

        if (areaFilter) {
            sql += ` WHERE p.id_area = ?`;
            params.push(areaFilter);
        }
        sql += ` ORDER BY a.nombre ASC, p.nombre ASC`;

        const puestosRes = await query(sql, params);

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
    const { id_area, nombre, descripcion, aplica_turnos, cantidad_contratada } = req.body;

    if (!id_area || !nombre) {
        return res.status(400).json({
            success: false,
            message: 'Debe seleccionar un área y especificar el nombre del puesto.'
        });
    }

    const turnosBit = (aplica_turnos === '1' || aplica_turnos === 'true' || aplica_turnos === true || aplica_turnos === 'on') ? 1 : 0;
    const contratadaVal = Math.max(0, parseInt(cantidad_contratada, 10) || 0);

    try {
        const check = await query('SELECT id_puesto FROM Puestos WHERE id_area = ? AND nombre = ?', [id_area, nombre.trim()]);

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe un puesto con el nombre "${nombre}" en el área seleccionada.`
            });
        }

        const insertRes = await query(`
            INSERT INTO Puestos (id_area, nombre, descripcion, aplica_turnos, cantidad_contratada, activo)
            VALUES (?, ?, ?, ?, ?, 1)
            RETURNING id_puesto
        `, [id_area, nombre.trim(), descripcion ? descripcion.trim() : null, turnosBit, contratadaVal]);

        return res.status(201).json({
            success: true,
            message: `Puesto "${nombre}" creado exitosamente.`,
            id_puesto: insertRes.recordset[0]?.id_puesto || insertRes.lastInsertRowid
        });
    } catch (err) {
        console.error('Error al crear puesto:', err);
        return res.status(500).json({
            success: false,
            message: 'No se pudo crear el puesto: ' + err.message
        });
    }
}

// Editar puesto
async function updatePuesto(req, res) {
    const { id_puesto, id_area, nombre, descripcion, aplica_turnos, cantidad_contratada, activo } = req.body;

    if (!id_puesto || !id_area || !nombre) {
        return res.status(400).json({
            success: false,
            message: 'Datos incompletos para actualizar el puesto.'
        });
    }

    const turnosBit = (aplica_turnos === '1' || aplica_turnos === 'true' || aplica_turnos === true || aplica_turnos === 'on') ? 1 : 0;
    const contratadaVal = Math.max(0, parseInt(cantidad_contratada, 10) || 0);

    try {
        const check = await query(
            'SELECT id_puesto FROM Puestos WHERE id_area = ? AND nombre = ? AND id_puesto != ?',
            [id_area, nombre.trim(), id_puesto]
        );

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Ya existe un puesto con el nombre "${nombre}" en dicha área.`
            });
        }

        await query(`
            UPDATE Puestos
            SET id_area = ?,
                nombre = ?,
                descripcion = ?,
                aplica_turnos = ?,
                cantidad_contratada = ?,
                activo = ?
            WHERE id_puesto = ?
        `, [id_area, nombre.trim(), descripcion ? descripcion.trim() : null, turnosBit, contratadaVal, activo ? 1 : 0, id_puesto]);

        return res.json({
            success: true,
            message: `Puesto "${nombre}" actualizado correctamente.`
        });
    } catch (err) {
        console.error('Error al actualizar puesto:', err);
        return res.status(500).json({
            success: false,
            message: 'No se pudo modificar el puesto: ' + err.message
        });
    }
}

// Activar o desactivar puesto
async function togglePuestoStatus(req, res) {
    const { id } = req.params;
    try {
        const result = await query(`
            UPDATE Puestos 
            SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END 
            WHERE id_puesto = ? 
            RETURNING activo
        `, [id]);

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

// API: Obtener puestos por ID de área
async function getPuestosByArea(req, res) {
    const { areaId } = req.params;
    try {
        const result = await query(`
            SELECT id_puesto, id_area, nombre, descripcion, COALESCE(aplica_turnos, 0) AS aplica_turnos, COALESCE(cantidad_contratada, 0) AS cantidad_contratada, activo
            FROM Puestos
            WHERE id_area = ? AND activo = 1
            ORDER BY nombre ASC
        `, [areaId]);

        return res.json({ success: true, puestos: result.recordset });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

// API: Obtener un puesto específico para edición
async function getPuestoById(req, res) {
    const { id } = req.params;
    try {
        const result = await query(
            'SELECT id_puesto, id_area, nombre, descripcion, COALESCE(aplica_turnos, 0) AS aplica_turnos, COALESCE(cantidad_contratada, 0) AS cantidad_contratada, activo FROM Puestos WHERE id_puesto = ?',
            [id]
        );

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Puesto no encontrado' });
        }
        return res.json({ success: true, puesto: result.recordset[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

// API / SSR: Consulta de plantilla de personal por área
async function showPlantilla(req, res) {
    return res.json({ success: true, message: 'Endpoint de plantilla listo' });
}

// API: Obtener los puestos y dotación contratada de un área
async function getPlantillaData(req, res) {
    const areaId = req.params.areaId ? parseInt(req.params.areaId, 10) : (req.query.areaId ? parseInt(req.query.areaId, 10) : null);
    const user = req.user || req.session.user;

    try {
        const { getUserAllowedAreas } = require('../middlewares/auth');
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        let selectedAreaId = areaId;
        if (!selectedAreaId && allowedAreas.length > 0) {
            selectedAreaId = allowedAreas[0].id_area;
        }

        if (selectedAreaId && user.rol_codigo !== 'ADMIN' && !areaIds.includes(selectedAreaId)) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permisos asignados para gestionar la plantilla del área seleccionada.'
            });
        }

        let puestos = [];
        let areaSeleccionada = null;
        if (selectedAreaId) {
            const areaRes = await query('SELECT id_area, nombre, codigo FROM Areas WHERE id_area = ?', [selectedAreaId]);
            areaSeleccionada = areaRes.recordset[0] || null;

            const puestosRes = await query(`
                SELECT 
                    p.id_puesto,
                    p.id_area,
                    p.nombre AS puesto_nombre,
                    p.nombre,
                    p.descripcion,
                    COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                    COALESCE(p.cantidad_contratada, 0) AS cantidad_contratada,
                    p.activo
                FROM Puestos p
                WHERE p.id_area = ? AND p.activo = 1
                ORDER BY p.nombre ASC
            `, [selectedAreaId]);
            puestos = puestosRes.recordset;
        }

        const totalContratados = puestos.reduce((sum, p) => sum + (p.cantidad_contratada || 0), 0);

        return res.json({
            success: true,
            areas: allowedAreas,
            selectedAreaId,
            areaSeleccionada,
            puestos,
            totalContratados
        });
    } catch (err) {
        console.error('Error al obtener datos de plantilla:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al consultar la plantilla de personal: ' + err.message
        });
    }
}

// API: Guardar la dotación presupuestada/contratada de puestos
async function savePlantilla(req, res) {
    const user = req.user || req.session.user;
    const { id_area, plantilla, puestos } = req.body;
    const listado = plantilla || puestos;

    if (!id_area || !listado || !Array.isArray(listado)) {
        return res.status(400).json({
            success: false,
            message: 'Parámetros inválidos. Debe proporcionar el área y la plantilla de puestos.'
        });
    }

    try {
        const { getUserAllowedAreas } = require('../middlewares/auth');
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        if (user.rol_codigo !== 'ADMIN' && !areaIds.includes(parseInt(id_area, 10))) {
            return res.status(403).json({
                success: false,
                message: 'No tienes autorización para modificar la plantilla de esta área.'
            });
        }

        for (const item of listado) {
            const idPuesto = parseInt(item.id_puesto, 10);
            const cantidad = Math.max(0, parseInt(item.cantidad_contratada, 10) || 0);

            if (idPuesto) {
                await query(`
                    UPDATE Puestos
                    SET cantidad_contratada = ?
                    WHERE id_puesto = ? AND id_area = ?
                `, [cantidad, idPuesto, id_area]);
            }
        }

        return res.json({
            success: true,
            message: 'Plantilla de personal contratado actualizada exitosamente.'
        });
    } catch (err) {
        console.error('Error al guardar plantilla:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al guardar la plantilla en Turso: ' + err.message
        });
    }
}

module.exports = {
    listPuestos,
    createPuesto,
    updatePuesto,
    togglePuestoStatus,
    getPuestosByArea,
    getPuestoById,
    showPlantilla,
    getPlantillaData,
    savePlantilla
};
