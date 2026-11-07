const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas, hasAreaAccess, getUserAllowedLocations, hasLocationAccess, isSoloVistaUser } = require('../middlewares/auth');
const { autocompletarAsistenciasPasadas } = require('../services/asistenciaService');

// Obtener fecha local en formato YYYY-MM-DD
function getLocalDateStr(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Mostrar formulario de registro diario
async function showRegistroForm(req, res) {
    const user = req.session.user;
    if (isSoloVistaUser(user)) {
        req.flash('error', 'Tu usuario tiene perfil de Solo Vista. No tienes permisos para registrar asistencias.');
        return res.redirect('/reportes');
    }

    const hoyStr = getLocalDateStr();
    let selectedAreaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    let selectedUbicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const isAdmin = Boolean(user && (String(user.rol_codigo).toUpperCase() === 'ADMIN' || user.id_rol === 1 || user.email === 'admin@asistencia.com'));

    // Restricción estricta: Solo se puede capturar la asistencia del día actual
    if (req.query.fecha && req.query.fecha !== hoyStr) {
        req.flash('error', `El registro de asistencia está habilitado exclusivamente para el día actual (${hoyStr}). Para consultar fechas pasadas, dirígete al Historial o Reportes.`);
        return res.redirect(`/asistencias/registro${selectedAreaId ? '?areaId=' + selectedAreaId : ''}`);
    }

    const selectedDate = hoyStr;

    try {
        const pool = await getPool();

        // Chequeo proactivo en segundo plano para autocompletar con 0 días anteriores pendientes
        autocompletarAsistenciasPasadas().catch(e => console.error('Error background autocomplete:', e.message));

        // Obtener áreas a las que el usuario puede registrar
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const registrableAreas = allowedAreas.filter(a => a.permite_registro == 1);

        // Si el usuario no especificó área en la URL pero solo tiene una autorizada, preseleccionarla automáticamente
        if (!selectedAreaId && registrableAreas.length === 1) {
            selectedAreaId = registrableAreas[0].id_area;
        }

        let slotsConAsistencia = [];
        let areaSeleccionadaInfo = null;
        let ubicacionesDisponibles = [];
        let ubicacionSeleccionadaInfo = null;

        if (selectedAreaId) {
            // Validar que el usuario tenga permiso en esta área
            const tieneAccesoArea = await hasAreaAccess(user.id_usuario, user.rol_codigo, selectedAreaId, 'registro');
            if (!tieneAccesoArea) {
                req.flash('error', 'No tienes permiso para registrar asistencia en el área seleccionada.');
                return res.redirect('/asistencias/registro');
            }

            // Datos del área seleccionada
            const areaInfoRes = await pool.request()
                .input('areaId', sql.Int, selectedAreaId)
                .query('SELECT id_area, codigo, nombre, descripcion FROM Areas WHERE id_area = @areaId');
            areaSeleccionadaInfo = areaInfoRes.recordset[0];

            // Obtener ubicaciones disponibles para el usuario en esta área
            ubicacionesDisponibles = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, selectedAreaId);

            // Si el área tiene ubicaciones:
            if (ubicacionesDisponibles.length > 0) {
                // Si solo hay una ubicación permitida y no se especificó otra, preseleccionarla
                if (!selectedUbicacionId && ubicacionesDisponibles.length === 1) {
                    selectedUbicacionId = ubicacionesDisponibles[0].id_ubicacion;
                }

                // Si se especificó una ubicación, validar acceso
                if (selectedUbicacionId) {
                    const tieneAccesoUb = await hasLocationAccess(user.id_usuario, user.rol_codigo, selectedAreaId, selectedUbicacionId);
                    if (!tieneAccesoUb) {
                        req.flash('error', 'No tienes permiso para registrar en la ubicación seleccionada.');
                        return res.redirect(`/asistencias/registro?areaId=${selectedAreaId}`);
                    }
                    ubicacionSeleccionadaInfo = ubicacionesDisponibles.find(u => u.id_ubicacion === selectedUbicacionId) || null;
                }
            } else {
                // El área no maneja ubicaciones desglosadas
                selectedUbicacionId = null;
            }

            // Solo cargamos puestos y asistencias si:
            // 1) El área NO tiene ubicaciones creadas, O
            // 2) El área SÍ tiene ubicaciones y ya se seleccionó una ubicación específica válida.
            const debeCargarPuestos = (ubicacionesDisponibles.length === 0) || Boolean(selectedUbicacionId);

            if (debeCargarPuestos) {
                // 1. Obtener todos los puestos activos del área
                const puestosRes = await pool.request()
                    .input('areaId', sql.Int, selectedAreaId)
                    .query(`
                        SELECT 
                            p.id_puesto,
                            p.nombre AS puesto_nombre,
                            p.descripcion AS puesto_descripcion,
                            ISNULL(p.aplica_turnos, 0) AS aplica_turnos
                        FROM Puestos p
                        WHERE p.id_area = @areaId AND p.activo = 1
                        ORDER BY p.nombre ASC
                    `);

                // 2. Obtener asistencias ya registradas en esa fecha, área y ubicación específica
                let queryAsistencias = `
                    SELECT 
                        ad.id_asistencia,
                        ad.id_puesto,
                        ad.id_ubicacion,
                        ISNULL(ad.turno, 'UNICO') AS turno,
                        ad.cantidad_asistentes,
                        ad.observaciones,
                        ad.fecha_registro,
                        ad.fecha_modificacion,
                        u.nombre AS registrado_por
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                    WHERE p.id_area = @areaId 
                      AND ad.fecha = @fecha
                `;

                const reqAsist = pool.request()
                    .input('areaId', sql.Int, selectedAreaId)
                    .input('fecha', sql.Date, selectedDate);

                if (selectedUbicacionId) {
                    queryAsistencias += ` AND ad.id_ubicacion = @ubicacionId`;
                    reqAsist.input('ubicacionId', sql.Int, selectedUbicacionId);
                } else {
                    queryAsistencias += ` AND (ad.id_ubicacion IS NULL OR ad.id_ubicacion = 0)`;
                }

                const asistenciasRes = await reqAsist.query(queryAsistencias);

                // Mapeo rápido de asistencias por [id_puesto_turno]
                const asistsMap = {};
                for (const a of asistenciasRes.recordset) {
                    asistsMap[`${a.id_puesto}_${a.turno}`] = a;
                }

                // 3. Estructurar cada slot por puesto y turno
                for (const p of puestosRes.recordset) {
                    const turnosConfig = (p.aplica_turnos === 1 || p.aplica_turnos === true)
                        ? [
                            { turno: 'TURNO_1', label: 'Turno 1', badgeClass: 'warning', icon: 'sun' },
                            { turno: 'TURNO_2', label: 'Turno 2', badgeClass: 'info', icon: 'moon' }
                          ]
                        : [
                            { turno: 'UNICO', label: 'Turno Único', badgeClass: 'secondary', icon: '' }
                          ];

                    for (const t of turnosConfig) {
                        const key = `${p.id_puesto}_${t.turno}`;
                        const asis = asistsMap[key] || null;
                        const guardado = !!asis;
                        // Solo el admin puede editar registros ya guardados. Si está pendiente, cualquiera autorizado puede registrarlo.
                        const editable = isAdmin || !guardado;

                        slotsConAsistencia.push({
                            key,
                            id_puesto: p.id_puesto,
                            puesto_nombre: p.puesto_nombre,
                            puesto_descripcion: p.puesto_descripcion,
                            aplica_turnos: p.aplica_turnos,
                            turno: t.turno,
                            turno_label: t.label,
                            turno_badge: t.badgeClass,
                            turno_icon: t.icon,
                            id_asistencia: asis ? asis.id_asistencia : null,
                            cantidad_asistentes: asis ? asis.cantidad_asistentes : '',
                            observaciones: asis ? (asis.observaciones || '') : '',
                            guardado,
                            editable,
                            registrado_por: asis ? asis.registrado_por : null,
                            fecha_registro: asis ? asis.fecha_registro : null,
                            fecha_modificacion: asis ? asis.fecha_modificacion : null
                        });
                    }
                }
            }
        }

        res.render('asistencias/registro', {
            title: 'Captura Diaria | Registro de Asistencia',
            areas: registrableAreas,
            selectedDate,
            hoy: hoyStr,
            esFechaPasada: selectedDate < hoyStr,
            selectedAreaId,
            areaSeleccionadaInfo,
            ubicacionesDisponibles,
            selectedUbicacionId,
            ubicacionSeleccionadaInfo,
            puestos: slotsConAsistencia,
            isAdmin,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al cargar vista de registro:', err);
        req.flash('error', 'Error al cargar la pantalla de registro: ' + err.message);
        res.redirect('/dashboard');
    }
}

// Guardar asistencias masivas por puestos del área en una fecha y ubicación
async function saveAsistencias(req, res) {
    const user = req.session.user;
    if (isSoloVistaUser(user)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: Los usuarios de Solo Vista no tienen permisos para capturar o modificar registros de asistencia.'
        });
    }

    const { fecha, id_area, id_ubicacion, items } = req.body;
    const isAdmin = Boolean(user && (String(user.rol_codigo).toUpperCase() === 'ADMIN' || user.id_rol === 1 || user.email === 'admin@asistencia.com'));
    const hoyStr = getLocalDateStr();

    if (!fecha || !id_area) {
        return res.status(400).json({ success: false, message: 'La fecha y el área son obligatorias.' });
    }

    const areaIdNum = parseInt(id_area, 10);
    const ubicacionIdNum = id_ubicacion ? parseInt(id_ubicacion, 10) : null;

    // Validación bloqueante: solo se permite capturar asistencia del día actual
    if (fecha !== hoyStr) {
        const errorMsg = `Acción rechazada: Solo está permitido registrar asistencias para el día de hoy (${hoyStr}). Fechas pasadas y futuras no pueden registrarse.`;
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(400).json({ success: false, message: errorMsg });
        }
        req.flash('error', errorMsg);
        return res.redirect(`/asistencias/registro?areaId=${id_area}`);
    }

    try {
        const pool = await getPool();

        // Validar permisos del usuario sobre el área
        const tieneAccesoArea = await hasAreaAccess(user.id_usuario, user.rol_codigo, areaIdNum, 'registro');
        if (!tieneAccesoArea) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para registrar en esta área.' });
        }

        // Si se indicó ubicación o si el área tiene ubicaciones obligatorias
        if (ubicacionIdNum) {
            const tieneAccesoUb = await hasLocationAccess(user.id_usuario, user.rol_codigo, areaIdNum, ubicacionIdNum);
            if (!tieneAccesoUb) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para registrar en la ubicación seleccionada.' });
            }
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Parsear lista de items
            let listaItems = [];
            if (Array.isArray(items)) {
                listaItems = items;
            } else if (typeof items === 'string') {
                listaItems = JSON.parse(items);
            } else if (req.body.puestos && typeof req.body.puestos === 'object') {
                listaItems = Object.values(req.body.puestos).map(p => ({
                    id_puesto: parseInt(p.id_puesto, 10),
                    turno: (p.turno || 'UNICO').trim(),
                    cantidad: (p.cantidad !== undefined && p.cantidad !== null) ? String(p.cantidad).trim() : '',
                    observaciones: p.observaciones ? String(p.observaciones).trim() : ''
                }));
            }

            let insertados = 0;
            let actualizados = 0;
            let omitidosProtegidos = 0;

            for (const item of listaItems) {
                const idPuesto = parseInt(item.id_puesto, 10);
                const turno = (item.turno || 'UNICO').trim();
                const rawCantidad = item.cantidad;
                const obs = item.observaciones && item.observaciones.length > 0 ? item.observaciones : null;

                if (isNaN(idPuesto)) continue;

                // Verificar existencia previa por (fecha, puesto, turno, ubicacion)
                let checkQuery = `
                    SELECT id_asistencia, cantidad_asistentes 
                    FROM Asistencias_Diarias 
                    WHERE fecha = @fecha 
                      AND id_puesto = @idPuesto 
                      AND turno = @turno
                `;

                const checkReq = new sql.Request(transaction)
                    .input('fecha', sql.Date, fecha)
                    .input('idPuesto', sql.Int, idPuesto)
                    .input('turno', sql.VarChar, turno);

                if (ubicacionIdNum) {
                    checkQuery += ` AND id_ubicacion = @idUb`;
                    checkReq.input('idUb', sql.Int, ubicacionIdNum);
                } else {
                    checkQuery += ` AND (id_ubicacion IS NULL OR id_ubicacion = 0)`;
                }

                const checkRes = await checkReq.query(checkQuery);
                const yaExiste = checkRes.recordset.length > 0;

                if (yaExiste) {
                    // Si ya existe: solo ADMIN puede modificar
                    if (!isAdmin) {
                        omitidosProtegidos++;
                        continue;
                    }

                    if (rawCantidad !== '') {
                        const cantNum = parseInt(rawCantidad, 10);
                        if (!isNaN(cantNum) && cantNum >= 0) {
                            let updateQuery = `
                                UPDATE Asistencias_Diarias
                                SET cantidad_asistentes = @cantidad,
                                    observaciones = @obs,
                                    id_usuario_modificacion = @userId,
                                    fecha_modificacion = GETDATE()
                                WHERE fecha = @fecha AND id_puesto = @idPuesto AND turno = @turno
                            `;
                            const updateReq = new sql.Request(transaction)
                                .input('fecha', sql.Date, fecha)
                                .input('idPuesto', sql.Int, idPuesto)
                                .input('turno', sql.VarChar, turno)
                                .input('cantidad', sql.Int, cantNum)
                                .input('obs', sql.NVarChar, obs)
                                .input('userId', sql.Int, user.id_usuario);

                            if (ubicacionIdNum) {
                                updateQuery += ` AND id_ubicacion = @idUb`;
                                updateReq.input('idUb', sql.Int, ubicacionIdNum);
                            } else {
                                updateQuery += ` AND (id_ubicacion IS NULL OR id_ubicacion = 0)`;
                            }

                            await updateReq.query(updateQuery);
                            actualizados++;
                        }
                    }
                } else {
                    // Si NO existe: insertar nuevo registro si tiene número capturado
                    if (rawCantidad !== '') {
                        const cantNum = parseInt(rawCantidad, 10);
                        if (!isNaN(cantNum) && cantNum >= 0) {
                            await new sql.Request(transaction)
                                .input('fecha', sql.Date, fecha)
                                .input('idPuesto', sql.Int, idPuesto)
                                .input('turno', sql.VarChar, turno)
                                .input('idUb', sql.Int, ubicacionIdNum || null)
                                .input('cantidad', sql.Int, cantNum)
                                .input('obs', sql.NVarChar, obs)
                                .input('userId', sql.Int, user.id_usuario)
                                .query(`
                                    INSERT INTO Asistencias_Diarias 
                                        (fecha, id_puesto, turno, id_ubicacion, cantidad_asistentes, observaciones, id_usuario_registro, fecha_registro)
                                    VALUES 
                                        (@fecha, @idPuesto, @turno, @idUb, @cantidad, @obs, @userId, GETDATE())
                                `);
                            insertados++;
                        }
                    }
                }
            }

            await transaction.commit();

            let msg = `Asistencia guardada: ${insertados} nuevo(s) registro(s).`;
            if (actualizados > 0) msg += ` ${actualizados} actualizado(s) por Administrador.`;
            if (omitidosProtegidos > 0) msg += ` ${omitidosProtegidos} ya registrado(s) previamente protegidos.`;

            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.json({ success: true, message: msg });
            }

            req.flash('success', msg);
            const redirectUrl = `/asistencias/registro?fecha=${fecha}&areaId=${id_area}${ubicacionIdNum ? '&ubicacionId=' + ubicacionIdNum : ''}`;
            return res.redirect(redirectUrl);
        } catch (trxError) {
            await transaction.rollback();
            throw trxError;
        }
    } catch (err) {
        console.error('Error al guardar asistencias:', err);
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(500).json({ success: false, message: 'Error interno al guardar: ' + err.message });
        }
        req.flash('error', 'Error al guardar las asistencias: ' + err.message);
        res.redirect(`/asistencias/registro?fecha=${fecha}&areaId=${id_area}`);
    }
}

// Historial y consulta de asistencias con filtro por Ubicación
async function listHistorial(req, res) {
    const user = req.session.user;
    const pool = await getPool();

    // Fechas por defecto: últimos 7 días
    const hoy = new Date();
    const sieteDiasAtras = new Date();
    sieteDiasAtras.setDate(hoy.getDate() - 7);

    const fechaInicio = req.query.fechaInicio || sieteDiasAtras.toISOString().split('T')[0];
    const fechaFin = req.query.fechaFin || hoy.toISOString().split('T')[0];
    const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    const ubicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;

    try {
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        let asistencias = [];
        let totales = { personas: 0, registros: 0 };
        let ubicacionesFiltro = [];

        if (areaIds.length > 0) {
            let filterAreas = areaId ? [areaId] : areaIds;
            // Validar que el área filtrada esté permitida
            if (areaId && !areaIds.includes(areaId)) {
                req.flash('error', 'No tienes permiso para consultar el área seleccionada.');
                return res.redirect('/asistencias/historial');
            }

            // Si se seleccionó un área, obtener sus ubicaciones para el filtro
            if (areaId) {
                ubicacionesFiltro = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, areaId);
            }

            const areaListStr = filterAreas.join(',');

            let query = `
                SELECT 
                    ad.id_asistencia,
                    ad.fecha,
                    ISNULL(ad.turno, 'UNICO') AS turno,
                    ad.cantidad_asistentes,
                    ad.observaciones,
                    ad.fecha_registro,
                    FORMAT(ad.fecha_registro, 'dd/MM/yyyy hh:mm tt') AS fecha_registro_texto,
                    FORMAT(ad.fecha_registro, 'hh:mm tt') AS hora_registro_texto,
                    ad.fecha_modificacion,
                    p.id_puesto,
                    p.nombre AS puesto_nombre,
                    ar.id_area,
                    ar.nombre AS area_nombre,
                    ar.codigo AS area_codigo,
                    ub.id_ubicacion,
                    ub.nombre AS ubicacion_nombre,
                    uReg.nombre AS registrado_por,
                    uMod.nombre AS modificado_por
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                INNER JOIN Areas ar ON p.id_area = ar.id_area
                LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                INNER JOIN Usuarios uReg ON ad.id_usuario_registro = uReg.id_usuario
                LEFT JOIN Usuarios uMod ON ad.id_usuario_modificacion = uMod.id_usuario
                WHERE ar.id_area IN (${areaListStr})
                  AND ad.fecha >= @fechaInicio AND ad.fecha <= @fechaFin
            `;

            const reqHist = pool.request()
                .input('fechaInicio', sql.Date, fechaInicio)
                .input('fechaFin', sql.Date, fechaFin);

            if (ubicacionId) {
                query += ` AND ad.id_ubicacion = @ubId`;
                reqHist.input('ubId', sql.Int, ubicacionId);
            }

            // Si el usuario no es admin, filtrar para que solo vea las ubicaciones a las que tiene acceso si el área tiene ubicaciones
            if (user.rol_codigo !== 'ADMIN') {
                query += `
                    AND (
                        ad.id_ubicacion IS NULL 
                        OR ad.id_ubicacion IN (SELECT id_ubicacion FROM Usuario_Ubicaciones WHERE id_usuario = ${user.id_usuario})
                    )
                `;
            }

            query += ` ORDER BY ad.fecha DESC, ar.nombre ASC, ub.nombre ASC, p.nombre ASC`;

            const result = await reqHist.query(query);

            asistencias = result.recordset;
            totales.registros = asistencias.length;
            totales.personas = asistencias.reduce((sum, item) => sum + item.cantidad_asistentes, 0);
        }

        res.render('asistencias/historial', {
            title: 'Historial de Asistencias | Registro de Asistencia',
            areas: allowedAreas,
            ubicacionesFiltro,
            asistencias,
            totales,
            fechaInicio,
            fechaFin,
            selectedAreaId: areaId,
            selectedUbicacionId: ubicacionId,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al listar historial:', err);
        req.flash('error', 'Error al cargar el historial.');
        res.redirect('/dashboard');
    }
}

module.exports = {
    showRegistroForm,
    saveAsistencias,
    listHistorial
};
