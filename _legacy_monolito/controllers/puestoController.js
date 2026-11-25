const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas, hasAreaAccess, isSoloVistaUser } = require('../middlewares/auth');

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
                ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
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

        res.render('puestos/index', {
            title: 'Gestión de Puestos de Trabajo | Registro de Asistencia',
            puestos: puestosRes.recordset,
            areas: areasRes.recordset,
            selectedAreaId: areaFilter,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al listar puestos:', err);
        req.flash('error', 'Error al cargar los puestos.');
        res.redirect('/dashboard');
    }
}

// Crear puesto
async function createPuesto(req, res) {
    const { id_area, nombre, descripcion, aplica_turnos, cantidad_contratada } = req.body;

    if (!id_area || !nombre) {
        req.flash('error', 'Debe seleccionar un área y especificar el nombre del puesto.');
        return res.redirect('/puestos');
    }

    const turnosBit = (aplica_turnos === '1' || aplica_turnos === 'true' || aplica_turnos === true || aplica_turnos === 'on') ? 1 : 0;
    const cantContratada = Math.max(0, parseInt(cantidad_contratada, 10) || 0);

    try {
        const pool = await getPool();

        // Verificar duplicado en la misma área
        const check = await pool.request()
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .query('SELECT id_puesto FROM Puestos WHERE id_area = @id_area AND nombre = @nombre');

        if (check.recordset.length > 0) {
            req.flash('error', `Ya existe un puesto con el nombre "${nombre}" en el área seleccionada.`);
            return res.redirect('/puestos');
        }

        await pool.request()
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .input('aplica_turnos', sql.Bit, turnosBit)
            .input('cantidad_contratada', sql.Int, cantContratada)
            .query(`
                INSERT INTO Puestos (id_area, nombre, descripcion, aplica_turnos, cantidad_contratada, activo)
                VALUES (@id_area, @nombre, @descripcion, @aplica_turnos, @cantidad_contratada, 1)
            `);

        req.flash('success', `Puesto "${nombre}" creado exitosamente con plantilla contratada de ${cantContratada}.`);
        res.redirect(`/puestos?areaId=${id_area}`);
    } catch (err) {
        console.error('Error al crear puesto:', err);
        req.flash('error', 'No se pudo crear el puesto: ' + err.message);
        res.redirect('/puestos');
    }
}

// Editar puesto
async function updatePuesto(req, res) {
    const { id_puesto, id_area, nombre, descripcion, aplica_turnos, activo, cantidad_contratada } = req.body;

    if (!id_puesto || !id_area || !nombre) {
        req.flash('error', 'Datos incompletos para actualizar el puesto.');
        return res.redirect('/puestos');
    }

    const turnosBit = (aplica_turnos === '1' || aplica_turnos === 'true' || aplica_turnos === true || aplica_turnos === 'on') ? 1 : 0;
    const activoBit = (activo === '1' || activo === 'true' || activo === true || activo === 'on') ? 1 : 0;
    const cantContratada = Math.max(0, parseInt(cantidad_contratada, 10) || 0);

    try {
        const pool = await getPool();

        // Validar unicidad en el área excluyendo el actual
        const check = await pool.request()
            .input('id_puesto', sql.Int, id_puesto)
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .query('SELECT id_puesto FROM Puestos WHERE id_area = @id_area AND nombre = @nombre AND id_puesto != @id_puesto');

        if (check.recordset.length > 0) {
            req.flash('error', `Ya existe un puesto con el nombre "${nombre}" en dicha área.`);
            return res.redirect('/puestos');
        }

        await pool.request()
            .input('id_puesto', sql.Int, id_puesto)
            .input('id_area', sql.Int, id_area)
            .input('nombre', sql.NVarChar, nombre.trim())
            .input('descripcion', sql.NVarChar, descripcion ? descripcion.trim() : null)
            .input('aplica_turnos', sql.Bit, turnosBit)
            .input('activo', sql.Bit, activoBit)
            .input('cantidad_contratada', sql.Int, cantContratada)
            .query(`
                UPDATE Puestos
                SET id_area = @id_area,
                    nombre = @nombre,
                    descripcion = @descripcion,
                    aplica_turnos = @aplica_turnos,
                    activo = @activo,
                    cantidad_contratada = @cantidad_contratada
                WHERE id_puesto = @id_puesto
            `);

        req.flash('success', `Puesto "${nombre}" actualizado correctamente.`);
        res.redirect(`/puestos?areaId=${id_area}`);
    } catch (err) {
        console.error('Error al actualizar puesto:', err);
        req.flash('error', 'No se pudo modificar el puesto: ' + err.message);
        res.redirect('/puestos');
    }
}

// Activar o desactivar puesto
async function togglePuestoStatus(req, res) {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Puestos SET activo = ~activo WHERE id_puesto = @id');

        req.flash('success', 'Estado del puesto actualizado.');
        res.redirect(req.headers.referer || '/puestos');
    } catch (err) {
        console.error('Error al alternar estado del puesto:', err);
        req.flash('error', 'Error al modificar el estado.');
        res.redirect('/puestos');
    }
}

// Mostrar apartado de Plantilla de Personal Contratado por Área
async function showPlantilla(req, res) {
    const user = req.user || (req.session && req.session.user);
    if (!user) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
        }
        return res.redirect('/auth/login');
    }

    if (isSoloVistaUser(user)) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({ success: false, message: 'Perfil de Solo Vista no autorizado.' });
        }
        req.flash('error', 'Tu usuario tiene perfil de Solo Vista y no puede configurar la plantilla.');
        return res.redirect('/reportes');
    }

    if (req.xhr || req.headers.accept?.includes('json')) {
        return getPlantillaData(req, res);
    }

    let selectedAreaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;

    try {
        const pool = await getPool();
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const registrableAreas = allowedAreas.filter(a => a.permite_registro == 1);

        if (!selectedAreaId && registrableAreas.length > 0) {
            selectedAreaId = registrableAreas[0].id_area;
        }

        let puestos = [];
        let areaSeleccionada = null;

        if (selectedAreaId) {
            const tieneAcceso = await hasAreaAccess(user.id_usuario, user.rol_codigo, selectedAreaId, 'registro');
            if (!tieneAcceso) {
                req.flash('error', 'No tienes permiso para administrar la plantilla en el área seleccionada.');
                return res.redirect('/puestos/plantilla');
            }

            const areaRes = await pool.request()
                .input('areaId', sql.Int, selectedAreaId)
                .query('SELECT id_area, codigo, nombre, descripcion FROM Areas WHERE id_area = @areaId');
            areaSeleccionada = areaRes.recordset[0] || null;

            const puestosRes = await pool.request()
                .input('areaId', sql.Int, selectedAreaId)
                .query(`
                    SELECT 
                        p.id_puesto,
                        p.nombre,
                        p.descripcion,
                        ISNULL(p.aplica_turnos, 0) AS aplica_turnos,
                        ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                        p.activo
                    FROM Puestos p
                    WHERE p.id_area = @areaId AND p.activo = 1
                    ORDER BY p.nombre ASC
                `);
            puestos = puestosRes.recordset;
        }

        const totalContratados = puestos.reduce((sum, p) => sum + (p.cantidad_contratada || 0), 0);

        res.render('puestos/plantilla', {
            title: 'Plantilla de Personal Contratado | Registro de Asistencia',
            areas: registrableAreas,
            selectedAreaId,
            areaSeleccionada,
            puestos,
            totalContratados,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al cargar plantilla de personal:', err);
        req.flash('error', 'Error al cargar la plantilla: ' + err.message);
        res.redirect('/dashboard');
    }
}

// API: Obtener datos de plantilla en formato JSON
async function getPlantillaData(req, res) {
    const user = req.user || (req.session && req.session.user);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
    }

    if (isSoloVistaUser(user)) {
        return res.status(403).json({ success: false, message: 'Perfil de Solo Vista no autorizado.' });
    }

    let selectedAreaId = req.params.areaId ? parseInt(req.params.areaId, 10) : (req.query.areaId ? parseInt(req.query.areaId, 10) : null);

    try {
        const pool = await getPool();
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const registrableAreas = allowedAreas.filter(a => a.permite_registro == 1);
        const areaIds = registrableAreas.map(a => a.id_area);

        if (registrableAreas.length === 0) {
            return res.json({
                success: true,
                areas: [],
                selectedAreaId: null,
                areaSeleccionada: null,
                puestos: [],
                totalContratados: 0,
                message: 'No tienes áreas asignadas con permiso de captura.'
            });
        }

        if (!selectedAreaId || !areaIds.includes(selectedAreaId)) {
            selectedAreaId = registrableAreas[0].id_area;
        }

        const tieneAcceso = await hasAreaAccess(user.id_usuario, user.rol_codigo, selectedAreaId, 'registro');
        if (!tieneAcceso) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para administrar la plantilla en esta área.' });
        }

        const areaRes = await pool.request()
            .input('areaId', sql.Int, selectedAreaId)
            .query('SELECT id_area, codigo, nombre, descripcion FROM Areas WHERE id_area = @areaId');
        const areaSeleccionada = areaRes.recordset[0] || null;

        const puestosRes = await pool.request()
            .input('areaId', sql.Int, selectedAreaId)
            .query(`
                SELECT 
                    p.id_puesto,
                    p.id_area,
                    p.nombre AS puesto_nombre,
                    p.nombre,
                    p.descripcion,
                    ISNULL(p.aplica_turnos, 0) AS aplica_turnos,
                    ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                    p.activo
                FROM Puestos p
                WHERE p.id_area = @areaId AND p.activo = 1
                ORDER BY p.nombre ASC
            `);
        const puestos = puestosRes.recordset;
        const totalContratados = puestos.reduce((sum, p) => sum + (p.cantidad_contratada || 0), 0);

        return res.json({
            success: true,
            areas: registrableAreas,
            selectedAreaId,
            areaSeleccionada,
            puestos,
            totalContratados
        });
    } catch (err) {
        console.error('Error al obtener datos de plantilla:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

// Guardar masivamente la plantilla contratada para un área
async function savePlantilla(req, res) {
    const user = req.user || (req.session && req.session.user);
    if (!user) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
        }
        return res.redirect('/auth/login');
    }

    if (isSoloVistaUser(user)) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({ success: false, message: 'Acceso denegado: Perfil de Solo Vista.' });
        }
        req.flash('error', 'Acceso denegado: Perfil de Solo Vista.');
        return res.redirect('/reportes');
    }

    const { id_area } = req.body;
    if (!id_area) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(400).json({ success: false, message: 'El área es obligatoria.' });
        }
        req.flash('error', 'El área es obligatoria.');
        return res.redirect('/puestos/plantilla');
    }

    const areaIdNum = parseInt(id_area, 10);

    try {
        const pool = await getPool();
        const tieneAcceso = await hasAreaAccess(user.id_usuario, user.rol_codigo, areaIdNum, 'registro');
        if (!tieneAcceso) {
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(403).json({ success: false, message: 'No tienes autorización para modificar la plantilla de esta área.' });
            }
            req.flash('error', 'No tienes permiso para modificar la plantilla en esta área.');
            return res.redirect('/puestos/plantilla');
        }

        // Parseo universal de puestos: soporta array de objetos, objeto clave-valor y objeto anidado
        let listaPuestos = [];
        const rawData = req.body.plantilla || req.body.puestos;

        if (Array.isArray(rawData)) {
            listaPuestos = rawData.map(p => ({
                id_puesto: parseInt(p.id_puesto || p.id, 10),
                cantidad_contratada: Math.max(0, parseInt(p.cantidad_contratada ?? p.cantidad ?? p.cant, 10) || 0)
            }));
        } else if (rawData && typeof rawData === 'object') {
            listaPuestos = Object.keys(rawData).map(key => {
                const val = rawData[key];
                const pId = parseInt(key, 10);
                if (val !== null && typeof val === 'object') {
                    return {
                        id_puesto: parseInt(val.id_puesto || val.id || pId, 10),
                        cantidad_contratada: Math.max(0, parseInt(val.cantidad_contratada ?? val.cantidad, 10) || 0)
                    };
                }
                return {
                    id_puesto: pId,
                    cantidad_contratada: Math.max(0, parseInt(val, 10) || 0)
                };
            });
        }

        let actualizados = 0;
        for (const item of listaPuestos) {
            if (isNaN(item.id_puesto) || item.id_puesto <= 0) continue;
            await pool.request()
                .input('idPuesto', sql.Int, item.id_puesto)
                .input('idArea', sql.Int, areaIdNum)
                .input('cant', sql.Int, item.cantidad_contratada)
                .query(`
                    UPDATE Puestos 
                    SET cantidad_contratada = @cant 
                    WHERE id_puesto = @idPuesto AND id_area = @idArea
                `);
            actualizados++;
        }

        const msg = `Plantilla de personal actualizada exitosamente (${actualizados} cargos configurados).`;
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({ success: true, message: msg, actualizados });
        }

        req.flash('success', msg);
        res.redirect(`/puestos/plantilla?areaId=${areaIdNum}`);
    } catch (err) {
        console.error('Error al guardar plantilla:', err);
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(500).json({ success: false, message: 'Error al guardar plantilla: ' + err.message });
        }
        req.flash('error', 'Error al guardar la plantilla: ' + err.message);
        res.redirect(`/puestos/plantilla?areaId=${id_area}`);
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
                SELECT id_puesto, id_area, nombre, descripcion, ISNULL(aplica_turnos, 0) AS aplica_turnos, ISNULL(cantidad_contratada, 0) AS cantidad_contratada, activo
                FROM Puestos
                WHERE id_area = @areaId AND activo = 1
                ORDER BY nombre ASC
            `);

        res.json({ success: true, puestos: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

// API: Obtener un puesto específico para edición
async function getPuestoById(req, res) {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id_puesto, id_area, nombre, descripcion, ISNULL(aplica_turnos, 0) AS aplica_turnos, ISNULL(cantidad_contratada, 0) AS cantidad_contratada, activo FROM Puestos WHERE id_puesto = @id');

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Puesto no encontrado' });
        }
        res.json({ success: true, puesto: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    listPuestos,
    createPuesto,
    updatePuesto,
    togglePuestoStatus,
    showPlantilla,
    getPlantillaData,
    savePlantilla,
    getPuestosByArea,
    getPuestoById
};
