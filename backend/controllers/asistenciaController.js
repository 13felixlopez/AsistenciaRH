const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas, hasAreaAccess, getUserAllowedLocations, hasLocationAccess, isSoloVistaUser } = require('../middlewares/auth');
const { autocompletarAsistenciasPasadas } = require('../services/asistenciaService');

// Obtener fecha local de Nicaragua (America/Managua, UTC-6) en formato YYYY-MM-DD
function getLocalDateStr(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Managua',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

// Normalizar identificador de turno
function normalizeTurno(t) {
    if (!t) return 'UNICO';
    const s = String(t).toUpperCase().trim();
    if (s === 'TURNO 1' || s === 'TURNO_1' || s === '1') return 'TURNO_1';
    if (s === 'TURNO 2' || s === 'TURNO_2' || s === '2') return 'TURNO_2';
    if (s === 'UNICO' || s === 'TURNO UNICO' || s === 'TURNO_UNICO') return 'UNICO';
    return s.replace(/\s+/g, '_');
}

// Obtener datos para formulario de registro diario en formato JSON
async function showRegistroForm(req, res) {
    const user = req.user || (req.session && req.session.user);
    if (isSoloVistaUser(user)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: Tu perfil es de Solo Vista y no tienes permiso para capturar asistencias.'
        });
    }

    const hoyStr = getLocalDateStr();
    let selectedAreaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    let selectedUbicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const isAdmin = Boolean(user && (String(user.rol_codigo).toUpperCase() === 'ADMIN' || user.id_rol === 1 || user.email === 'admin@asistencia.com'));

    // Restricción: Supervisores solo día actual, Administradores pueden registrar y corregir cualquier fecha
    let selectedDate = hoyStr;
    if (req.query.fecha) {
        if (!isAdmin && req.query.fecha !== hoyStr) {
            return res.status(400).json({
                success: false,
                message: `El registro de asistencia para supervisores está habilitado exclusivamente para el día actual (${hoyStr}). Para consultar fechas pasadas, dirígete al Historial.`
            });
        }
        selectedDate = req.query.fecha;
    }

    try {
        const pool = await getPool();

        // Chequeo en segundo plano para autocompletar con 0 días anteriores pendientes
        autocompletarAsistenciasPasadas().catch(e => console.error('Error background autocomplete:', e.message));

        // Obtener áreas a las que el usuario puede registrar
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const registrableAreas = allowedAreas.filter(a => a.permite_registro == 1);

        // Si el usuario no especificó área pero solo tiene una autorizada, preseleccionarla
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
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permiso para registrar asistencia en el área seleccionada.'
                });
            }

            // Datos del área seleccionada
            const areaInfoRes = await pool.request()
                .input('areaId', sql.Int, selectedAreaId)
                .query('SELECT id_area, codigo, nombre, descripcion FROM Areas WHERE id_area = @areaId');
            areaSeleccionadaInfo = areaInfoRes.recordset[0];

            // Obtener ubicaciones disponibles para el usuario en esta área
            ubicacionesDisponibles = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, selectedAreaId);

            if (ubicacionesDisponibles.length > 0) {
                if (!selectedUbicacionId && ubicacionesDisponibles.length === 1) {
                    selectedUbicacionId = ubicacionesDisponibles[0].id_ubicacion;
                }

                if (selectedUbicacionId) {
                    const tieneAccesoUb = await hasLocationAccess(user.id_usuario, user.rol_codigo, selectedAreaId, selectedUbicacionId);
                    if (!tieneAccesoUb) {
                        return res.status(403).json({
                            success: false,
                            message: 'No tienes permiso para registrar en la ubicación seleccionada.'
                        });
                    }
                    ubicacionSeleccionadaInfo = ubicacionesDisponibles.find(u => u.id_ubicacion === selectedUbicacionId) || null;
                }
            } else {
                selectedUbicacionId = null;
            }

            const debeCargarPuestos = (ubicacionesDisponibles.length === 0) || Boolean(selectedUbicacionId);

            if (debeCargarPuestos) {
                // 1. Obtener todos los puestos activos del área con cantidad_contratada
                const puestosRes = await pool.request()
                    .input('areaId', sql.Int, selectedAreaId)
                    .query(`
                        SELECT 
                            p.id_puesto,
                            p.nombre AS puesto_nombre,
                            p.descripcion AS puesto_descripcion,
                            ISNULL(p.aplica_turnos, 0) AS aplica_turnos,
                            ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
                            ISNULL(p.activo, 1) AS activo
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
                    queryAsistencias += ' AND ad.id_ubicacion = @ubicacionId';
                    reqAsist.input('ubicacionId', sql.Int, selectedUbicacionId);
                } else {
                    queryAsistencias += ' AND (ad.id_ubicacion IS NULL OR ad.id_ubicacion = 0)';
                }

                const asistenciasRes = await reqAsist.query(queryAsistencias);

                // Mapeo rápido de asistencias por [id_puesto_turno] con normalización de turno
                const asistsMap = {};
                for (const a of asistenciasRes.recordset) {
                    const tNorm = normalizeTurno(a.turno);
                    asistsMap[`${a.id_puesto}_${tNorm}`] = a;
                }

                // 3. Estructurar cada slot por puesto y turno
                for (const p of puestosRes.recordset) {
                    const cantContratada = parseInt(p.cantidad_contratada, 10) || 0;
                    const sinDotacion = cantContratada <= 0;

                    const turnosConfig = (p.aplica_turnos === 1 || p.aplica_turnos === true || p.aplica_turnos === '1')
                        ? [
                            { turno: 'TURNO_1', label: 'Turno 1 (Día)', badgeClass: 'warning text-dark', icon: 'bi-sun-fill' },
                            { turno: 'TURNO_2', label: 'Turno 2 (Noche)', badgeClass: 'primary', icon: 'bi-moon-stars-fill' }
                          ]
                        : [
                            { turno: 'UNICO', label: 'Turno Único', badgeClass: 'secondary', icon: '' }
                          ];

                    for (const t of turnosConfig) {
                        const key = `${p.id_puesto}_${t.turno}`;
                        const asis = asistsMap[key] || null;
                        const guardado = !!asis;
                        // Si la plantilla es 0, no requiere captura manual de personal (asistencia 0).
                        // Si tiene plantilla > 0: editable si es admin o si aún no está guardado.
                        const editable = sinDotacion ? false : (isAdmin || !guardado);

                        slotsConAsistencia.push({
                            key,
                            id_puesto: p.id_puesto,
                            puesto_nombre: p.puesto_nombre,
                            puesto_descripcion: p.puesto_descripcion,
                            aplica_turnos: p.aplica_turnos,
                            cantidad_contratada: cantContratada,
                            sin_dotacion: sinDotacion,
                            requiere_plantilla: false,
                            turno: t.turno,
                            turno_label: t.label,
                            turno_badge: t.badgeClass,
                            turno_icon: t.icon,
                            id_asistencia: asis ? asis.id_asistencia : null,
                            cantidad_asistentes: asis ? asis.cantidad_asistentes : (sinDotacion ? 0 : ''),
                            observaciones: asis ? (asis.observaciones || '') : '',
                            guardado: guardado || sinDotacion,
                            editable,
                            registrado_por: asis ? asis.registrado_por : null,
                            fecha_registro: asis ? asis.fecha_registro : null,
                            fecha_modificacion: asis ? asis.fecha_modificacion : null
                        });
                    }
                }
            }
        }

        return res.json({
            success: true,
            data: {
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
                isAdmin
            }
        });
    } catch (err) {
        console.error('Error al cargar datos de registro:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar la pantalla de registro: ' + err.message
        });
    }
}

// Guardar asistencias masivas por puestos del área en una fecha y ubicación
async function saveAsistencias(req, res) {
    const user = req.user || (req.session && req.session.user);
    if (isSoloVistaUser(user)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: Los usuarios de Solo Vista no pueden registrar ni modificar asistencias.'
        });
    }

    let { fecha, id_area, id_ubicacion, items } = req.body;
    const isAdmin = Boolean(user && (String(user.rol_codigo).toUpperCase() === 'ADMIN' || user.id_rol === 1 || user.email === 'admin@asistencia.com'));
    const hoyStr = getLocalDateStr();

    if (!fecha || !id_area) {
        return res.status(400).json({ success: false, message: 'La fecha y el área son obligatorias.' });
    }

    const areaIdNum = parseInt(id_area, 10);
    const ubicacionIdNum = id_ubicacion ? parseInt(id_ubicacion, 10) : null;

    // Validación: supervisores solo día actual, admin cualquier día
    if (!isAdmin && fecha !== hoyStr) {
        return res.status(400).json({
            success: false,
            message: `Acción rechazada: Los supervisores solo pueden capturar asistencia del día de hoy (${hoyStr}).`
        });
    }

    try {
        const pool = await getPool();

        // Validar permisos del usuario sobre el área
        const tieneAccesoArea = await hasAreaAccess(user.id_usuario, user.rol_codigo, areaIdNum, 'registro');
        if (!tieneAccesoArea) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para registrar en esta área.' });
        }

        if (ubicacionIdNum) {
            const tieneAccesoUb = await hasLocationAccess(user.id_usuario, user.rol_codigo, areaIdNum, ubicacionIdNum);
            if (!tieneAccesoUb) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para registrar en la ubicación seleccionada.' });
            }
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Obtener metadatos de puestos para validar plantilla
            const puestosMetaRes = await new sql.Request(transaction)
                .input('areaId', sql.Int, areaIdNum)
                .query(`
                    SELECT 
                        id_puesto, 
                        nombre, 
                        ISNULL(activo, 1) AS activo, 
                        ISNULL(cantidad_contratada, 0) AS cantidad_contratada,
                        ISNULL(aplica_turnos, 0) AS aplica_turnos
                    FROM Puestos 
                    WHERE id_area = @areaId
                `);
            const puestosMap = {};
            for (const p of puestosMetaRes.recordset) {
                puestosMap[p.id_puesto] = p;
            }

            // Normalizar items ya sea que vengan como array, string JSON, o como req.body.puestos
            let itemsArray = [];
            if (Array.isArray(items)) {
                itemsArray = items;
            } else if (typeof items === 'string') {
                try { itemsArray = JSON.parse(items); } catch(e) { itemsArray = []; }
            } else if (items && typeof items === 'object') {
                itemsArray = Object.keys(items).map(key => {
                    const parts = key.split('_');
                    const idPuesto = parseInt(parts[0], 10);
                    const turno = parts.slice(1).join('_') || 'UNICO';
                    return {
                        id_puesto: idPuesto,
                        turno,
                        cantidad: items[key].cantidad !== undefined ? items[key].cantidad : items[key],
                        observaciones: items[key].observaciones || ''
                    };
                });
            } else if (req.body.puestos && typeof req.body.puestos === 'object') {
                itemsArray = Object.values(req.body.puestos).map(p => ({
                    id_puesto: parseInt(p.id_puesto, 10),
                    turno: normalizeTurno(p.turno),
                    cantidad: (p.cantidad !== undefined && p.cantidad !== null) ? String(p.cantidad).trim() : '',
                    observaciones: p.observaciones ? String(p.observaciones).trim() : ''
                }));
            }

            let totalProcesados = 0;

            for (const item of itemsArray) {
                const idPuesto = parseInt(item.id_puesto, 10);
                const turno = normalizeTurno(item.turno);
                const rawCantidad = item.cantidad !== undefined ? item.cantidad : item.cantidad_asistentes;

                if (rawCantidad === '' || rawCantidad === null || rawCantidad === undefined || isNaN(rawCantidad)) {
                    continue; // Puesto omitido
                }

                const cantidad = parseInt(rawCantidad, 10);
                if (cantidad < 0) continue;

                // Validar contra plantilla contratada
                const pMeta = puestosMap[idPuesto];
                if (pMeta) {
                    const esActivo = (pMeta.activo === 1 || pMeta.activo === true || pMeta.activo === '1');
                    const contratada = parseInt(pMeta.cantidad_contratada, 10) || 0;

                    // La cantidad de asistentes no puede superar el límite contratado en plantilla
                    if (esActivo && cantidad > contratada) {
                        if (contratada === 0) {
                            throw new Error(`El puesto "${pMeta.nombre}" tiene una plantilla autorizada de 0 personas. Para registrar ${cantidad} asistentes, configure primero el personal contratado en la sección de Plantilla.`);
                        } else {
                            throw new Error(`El puesto "${pMeta.nombre}" tiene un tope de personal contratado de ${contratada} personas. La cantidad ingresada (${cantidad}) sobrepasa dicho límite.`);
                        }
                    }
                }

                const observaciones = item.observaciones ? String(item.observaciones).trim() : null;

                // Verificar si ya existe registro para este puesto, fecha, turno y ubicación contemplando estandarización de turno
                const checkReq = new sql.Request(transaction)
                    .input('idPuesto', sql.Int, idPuesto)
                    .input('fecha', sql.Date, fecha)
                    .input('turno', sql.VarChar, turno)
                    .input('turnoNorm', sql.VarChar, turno);

                let checkQuery = `
                    SELECT id_asistencia, cantidad_asistentes 
                    FROM Asistencias_Diarias 
                    WHERE id_puesto = @idPuesto AND fecha = @fecha AND (turno = @turno OR UPPER(REPLACE(turno, ' ', '_')) = @turnoNorm)
                `;

                if (ubicacionIdNum) {
                    checkQuery += ' AND id_ubicacion = @ubId';
                    checkReq.input('ubId', sql.Int, ubicacionIdNum);
                } else {
                    checkQuery += ' AND (id_ubicacion IS NULL OR id_ubicacion = 0)';
                }

                const existingRes = await checkReq.query(checkQuery);

                if (existingRes.recordset.length > 0) {
                    // Ya existe registro: solo el administrador puede modificar
                    if (!isAdmin) {
                        continue; // Omitir actualización si no es admin
                    }

                    const idAsistencia = existingRes.recordset[0].id_asistencia;
                    await new sql.Request(transaction)
                        .input('id', sql.Int, idAsistencia)
                        .input('cantidad', sql.Int, cantidad)
                        .input('obs', sql.NVarChar, observaciones)
                        .input('userId', sql.Int, user.id_usuario)
                        .query(`
                            UPDATE Asistencias_Diarias 
                            SET cantidad_asistentes = @cantidad,
                                observaciones = @obs,
                                id_usuario_modificacion = @userId,
                                fecha_modificacion = GETDATE()
                            WHERE id_asistencia = @id
                        `);
                    totalProcesados++;
                } else {
                    // Inserción de nuevo registro
                    const insertReq = new sql.Request(transaction)
                        .input('idPuesto', sql.Int, idPuesto)
                        .input('fecha', sql.Date, fecha)
                        .input('turno', sql.VarChar, turno)
                        .input('cantidad', sql.Int, cantidad)
                        .input('obs', sql.NVarChar, observaciones)
                        .input('userId', sql.Int, user.id_usuario);

                    if (ubicacionIdNum) {
                        insertReq.input('ubId', sql.Int, ubicacionIdNum);
                    }

                    await insertReq.query(`
                        INSERT INTO Asistencias_Diarias (id_puesto, fecha, turno, id_ubicacion, cantidad_asistentes, observaciones, id_usuario_registro, fecha_registro)
                        VALUES (@idPuesto, @fecha, @turno, ${ubicacionIdNum ? '@ubId' : 'NULL'}, @cantidad, @obs, @userId, GETDATE())
                    `);
                    totalProcesados++;
                }
            }

            await transaction.commit();

            return res.json({
                success: true,
                message: totalProcesados > 0
                    ? `Se guardaron ${totalProcesados} registro(s) de asistencia correctamente.`
                    : 'No hubo cambios que guardar o los registros ya estaban protegidos.'
            });
        } catch (trxError) {
            await transaction.rollback();
            throw trxError;
        }
    } catch (err) {
        console.error('Error al guardar asistencias en API:', err);
        return res.status(400).json({
            success: false,
            message: 'Error al procesar registros de asistencia: ' + err.message
        });
    }
}

// Corregir un registro individual de asistencia (Exclusivo para Administrador)
async function corregirAsistencia(req, res) {
    const user = req.user || (req.session && req.session.user);
    const isAdmin = Boolean(user && (String(user.rol_codigo).toUpperCase() === 'ADMIN' || user.id_rol === 1 || user.email === 'admin@asistencia.com'));
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: Solo los usuarios con rol Administrador pueden corregir asistencias grabadas.'
        });
    }

    const { id_asistencia, cantidad_asistentes, observaciones } = req.body;
    if (!id_asistencia || cantidad_asistentes === undefined || cantidad_asistentes === null || isNaN(cantidad_asistentes)) {
        return res.status(400).json({
            success: false,
            message: 'Se requiere el ID de asistencia y una cantidad numérica válida.'
        });
    }

    const cantNum = parseInt(cantidad_asistentes, 10);
    if (cantNum < 0) {
        return res.status(400).json({
            success: false,
            message: 'La cantidad de personas no puede ser negativa.'
        });
    }

    try {
        const pool = await getPool();

        // Validar puesto y su plantilla contratada
        const asisRes = await pool.request()
            .input('id', sql.Int, parseInt(id_asistencia, 10))
            .query(`
                SELECT 
                    ad.id_asistencia,
                    ad.id_puesto,
                    ad.cantidad_asistentes,
                    p.nombre AS puesto_nombre,
                    ISNULL(p.activo, 1) AS activo,
                    ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                WHERE ad.id_asistencia = @id
            `);

        if (asisRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro de asistencia no encontrado.' });
        }

        const asis = asisRes.recordset[0];
        const esActivo = (asis.activo === 1 || asis.activo === true || asis.activo === '1');
        const contratada = parseInt(asis.cantidad_contratada, 10) || 0;

        if (esActivo && cantNum > contratada) {
            if (contratada === 0) {
                return res.status(400).json({
                    success: false,
                    message: `No se puede guardar: El puesto "${asis.puesto_nombre}" tiene una plantilla autorizada de 0 personas. Configure primero el personal contratado en Plantilla.`
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: `No se puede guardar: El puesto "${asis.puesto_nombre}" tiene un tope de personal contratado de ${contratada}. La cantidad ingresada (${cantNum}) lo sobrepasa.`
                });
            }
        }

        await pool.request()
            .input('id', sql.Int, parseInt(id_asistencia, 10))
            .input('cantidad', sql.Int, cantNum)
            .input('obs', sql.NVarChar, observaciones ? String(observaciones).trim() : null)
            .input('userId', sql.Int, user.id_usuario)
            .query(`
                UPDATE Asistencias_Diarias
                SET cantidad_asistentes = @cantidad,
                    observaciones = @obs,
                    id_usuario_modificacion = @userId,
                    fecha_modificacion = GETDATE()
                WHERE id_asistencia = @id
            `);

        return res.json({
            success: true,
            message: `Asistencia para "${asis.puesto_nombre}" corregida exitosamente a ${cantNum} asistentes.`
        });
    } catch (err) {
        console.error('Error al corregir asistencia:', err);
        return res.status(500).json({
            success: false,
            message: 'Error interno al corregir asistencia: ' + err.message
        });
    }
}

// Historial detallado de asistencias
async function listHistorial(req, res) {
    const user = req.user || (req.session && req.session.user);
    const pool = await getPool();

    // Fechas por defecto: últimos 7 días
    const hoyStr = getLocalDateStr();
    const sieteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fechaInicioDefault = getLocalDateStr(sieteDiasAtras);

    const fechaInicio = req.query.fechaInicio || fechaInicioDefault;
    const fechaFin = req.query.fechaFin || hoyStr;
    const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
    const ubicacionId = req.query.ubicacionId ? parseInt(req.query.ubicacionId, 10) : null;
    const isAdmin = Boolean(user && (String(user.rol_codigo).toUpperCase() === 'ADMIN' || user.id_rol === 1 || user.email === 'admin@asistencia.com'));

    try {
        const allowedAreas = await getUserAllowedAreas(user.id_usuario, user.rol_codigo);
        const areaIds = allowedAreas.map(a => a.id_area);

        let asistencias = [];
        let totales = { personas: 0, registros: 0 };
        let ubicacionesFiltro = [];

        if (areaIds.length > 0) {
            let filterAreas = areaId ? [areaId] : areaIds;
            if (areaId && !areaIds.includes(areaId)) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permiso para consultar el área seleccionada.'
                });
            }

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
                    ISNULL(p.cantidad_contratada, 0) AS cantidad_contratada,
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
                query += ' AND ad.id_ubicacion = @ubId';
                reqHist.input('ubId', sql.Int, ubicacionId);
            }

            if (!isAdmin) {
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

        return res.json({
            success: true,
            data: {
                areas: allowedAreas,
                ubicacionesFiltro,
                asistencias,
                totales,
                fechaInicio,
                fechaFin,
                selectedAreaId: areaId,
                selectedUbicacionId: ubicacionId,
                isAdmin
            }
        });
    } catch (err) {
        console.error('Error al listar historial:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar el historial: ' + err.message
        });
    }
}

module.exports = {
    showRegistroForm,
    saveAsistencias,
    corregirAsistencia,
    listHistorial
};
