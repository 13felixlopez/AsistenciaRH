const { query } = require('../config/db');
const { getUserAllowedAreas, hasAreaAccess, getUserAllowedLocations, hasLocationAccess, isSoloVistaUser } = require('../middlewares/auth');
const { autocompletarAsistenciasPasadas, getLocalDateStr } = require('../services/asistenciaService');

// Obtener datos para formulario de registro diario en formato JSON
async function showRegistroForm(req, res) {
    const user = req.user || req.session.user;
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

    // Restricción: Solo se puede capturar la asistencia del día actual
    if (req.query.fecha && req.query.fecha !== hoyStr) {
        return res.status(400).json({
            success: false,
            message: `El registro de asistencia está habilitado exclusivamente para el día actual (${hoyStr}). Para consultar fechas pasadas, dirígete al Historial o Reportes.`
        });
    }

    const selectedDate = hoyStr;

    try {
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
            const tieneAccesoArea = await hasAreaAccess(user.id_usuario, user.rol_codigo, selectedAreaId, 'registro');
            if (!tieneAccesoArea) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permiso para registrar asistencia en el área seleccionada.'
                });
            }

            // Datos del área seleccionada
            const areaInfoRes = await query('SELECT id_area, codigo, nombre, descripcion FROM Areas WHERE id_area = ?', [selectedAreaId]);
            areaSeleccionadaInfo = areaInfoRes.recordset[0] || null;

            // Obtener ubicaciones disponibles
            ubicacionesDisponibles = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, selectedAreaId);

            if (selectedUbicacionId) {
                const tieneAccesoUbicacion = await hasLocationAccess(user.id_usuario, user.rol_codigo, selectedAreaId, selectedUbicacionId);
                if (!tieneAccesoUbicacion) {
                    return res.status(403).json({
                        success: false,
                        message: 'No tienes permiso para registrar asistencia en la ubicación seleccionada.'
                    });
                }
                const ubInfoRes = await query('SELECT id_ubicacion, id_area, codigo, nombre FROM Ubicaciones WHERE id_ubicacion = ?', [selectedUbicacionId]);
                ubicacionSeleccionadaInfo = ubInfoRes.recordset[0] || null;
            } else if (ubicacionesDisponibles.length === 1) {
                selectedUbicacionId = ubicacionesDisponibles[0].id_ubicacion;
                ubicacionSeleccionadaInfo = ubicacionesDisponibles[0];
            }

            const requiereUbicacion = ubicacionesDisponibles.length > 0;
            const puedeCargarPuestos = !requiereUbicacion || (requiereUbicacion && selectedUbicacionId);

            if (puedeCargarPuestos) {
                const puestosRes = await query(`
                    SELECT 
                        p.id_puesto, 
                        p.nombre AS puesto_nombre, 
                        p.descripcion AS puesto_descripcion,
                        COALESCE(p.aplica_turnos, 0) AS aplica_turnos
                    FROM Puestos p
                    WHERE p.id_area = ? AND p.activo = 1
                    ORDER BY p.nombre ASC
                `, [selectedAreaId]);

                let queryAsistencias = `
                    SELECT 
                        ad.id_asistencia,
                        ad.id_puesto,
                        ad.id_ubicacion,
                        ad.turno,
                        ad.cantidad_asistentes,
                        ad.observaciones,
                        ad.fecha_registro,
                        ad.fecha_modificacion,
                        u.nombre AS registrado_por
                    FROM Asistencias_Diarias ad
                    INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                    LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                    WHERE p.id_area = ? AND ad.fecha = ?
                `;
                const paramsAsist = [selectedAreaId, selectedDate];

                if (selectedUbicacionId) {
                    queryAsistencias += ` AND ad.id_ubicacion = ?`;
                    paramsAsist.push(selectedUbicacionId);
                } else {
                    queryAsistencias += ` AND (ad.id_ubicacion IS NULL OR ad.id_ubicacion = 0)`;
                }

                const asistenciasRes = await query(queryAsistencias, paramsAsist);

                const asistsMap = {};
                for (const a of asistenciasRes.recordset) {
                    asistsMap[`${a.id_puesto}_${a.turno}`] = a;
                }

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
    const user = req.user || req.session.user;
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

    if (fecha !== hoyStr) {
        return res.status(400).json({
            success: false,
            message: `Acción rechazada: Solo está permitido registrar asistencias para el día de hoy (${hoyStr}).`
        });
    }

    try {
        const tieneAccesoArea = await hasAreaAccess(user.id_usuario, user.rol_codigo, areaIdNum, 'registro');
        if (!tieneAccesoArea) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para registrar en esta área.' });
        }

        if (ubicacionIdNum) {
            const tieneAccesoUbicacion = await hasLocationAccess(user.id_usuario, user.rol_codigo, areaIdNum, ubicacionIdNum);
            if (!tieneAccesoUbicacion) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para registrar en esta ubicación.' });
            }
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No se recibieron datos de puestos para guardar.' });
        }

        let guardados = 0;
        let actualizados = 0;
        let ignoradosPorSupervisor = 0;

        for (const item of items) {
            const puestoId = parseInt(item.id_puesto, 10);
            const turnoVal = (item.turno || 'UNICO').toUpperCase();

            if (!puestoId) continue;

            const valStr = (item.cantidad === null || item.cantidad === undefined || item.cantidad === '') ? '' : String(item.cantidad).trim();
            if (valStr === '') continue;

            const cantidadVal = parseInt(valStr, 10);
            if (isNaN(cantidadVal) || cantidadVal < 0) continue;

            const observacionesVal = item.observaciones ? item.observaciones.trim() : null;

            // Verificar si ya existe registro
            let checkSql = 'SELECT id_asistencia FROM Asistencias_Diarias WHERE fecha = ? AND id_puesto = ? AND turno = ?';
            const checkParams = [fecha, puestoId, turnoVal];

            if (ubicacionIdNum) {
                checkSql += ' AND id_ubicacion = ?';
                checkParams.push(ubicacionIdNum);
            } else {
                checkSql += ' AND (id_ubicacion IS NULL OR id_ubicacion = 0)';
            }

            const check = await query(checkSql, checkParams);

            if (check.recordset.length > 0) {
                // Ya existe registro
                if (!isAdmin) {
                    ignoradosPorSupervisor++;
                    continue;
                }

                // Admin puede actualizar
                const idAsistenciaExistente = check.recordset[0].id_asistencia;
                await query(`
                    UPDATE Asistencias_Diarias
                    SET cantidad_asistentes = ?,
                        observaciones = ?,
                        fecha_modificacion = datetime('now', 'localtime')
                    WHERE id_asistencia = ?
                `, [cantidadVal, observacionesVal, idAsistenciaExistente]);
                actualizados++;
            } else {
                // Nuevo registro
                await query(`
                    INSERT INTO Asistencias_Diarias (
                        fecha, id_puesto, id_ubicacion, turno, cantidad_asistentes, observaciones, id_usuario_registro, fecha_registro
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime')
                    )
                `, [fecha, puestoId, ubicacionIdNum || null, turnoVal, cantidadVal, observacionesVal, user.id_usuario]);
                guardados++;
            }
        }

        let message = `Se procesaron los registros de asistencia. Guardados: ${guardados}, Actualizados: ${actualizados}.`;
        if (ignoradosPorSupervisor > 0) {
            message += ` (${ignoradosPorSupervisor} puestos ya estaban guardados y no pueden ser modificados sin rol Administrador).`;
        }

        return res.json({
            success: true,
            message,
            guardados,
            actualizados,
            ignoradosPorSupervisor
        });
    } catch (err) {
        console.error('Error al guardar asistencias:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al guardar asistencias: ' + err.message
        });
    }
}

// Historial de asistencias
async function listHistorial(req, res) {
    const user = req.user || req.session.user;
    const hoy = new Date();
    const sieteDiasAtras = new Date(hoy);
    sieteDiasAtras.setDate(sieteDiasAtras.getDate() - 7);

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
            if (areaId && !areaIds.includes(areaId)) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para consultar el área seleccionada.' });
            }

            if (areaId) {
                ubicacionesFiltro = await getUserAllowedLocations(user.id_usuario, user.rol_codigo, areaId);
            }

            let placeholders = filterAreas.map(() => '?').join(',');
            let sql = `
                SELECT 
                    ad.id_asistencia,
                    ad.fecha,
                    ad.cantidad_asistentes,
                    ad.observaciones,
                    ad.fecha_registro,
                    ad.turno,
                    CASE 
                        WHEN ad.turno = 'TURNO_1' THEN 'Turno 1'
                        WHEN ad.turno = 'TURNO_2' THEN 'Turno 2'
                        ELSE 'Turno Único'
                    END AS turno_label,
                    p.id_puesto,
                    p.nombre AS puesto_nombre,
                    COALESCE(p.aplica_turnos, 0) AS aplica_turnos,
                    a.id_area,
                    a.nombre AS area_nombre,
                    a.codigo AS area_codigo,
                    ub.id_ubicacion,
                    ub.nombre AS ubicacion_nombre,
                    u.nombre AS registrado_por
                FROM Asistencias_Diarias ad
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                INNER JOIN Areas a ON p.id_area = a.id_area
                LEFT JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                LEFT JOIN Usuarios u ON ad.id_usuario_registro = u.id_usuario
                WHERE p.id_area IN (${placeholders})
                  AND ad.fecha >= ?
                  AND ad.fecha <= ?
            `;
            const params = [...filterAreas, fechaInicio, fechaFin];

            if (ubicacionId) {
                sql += ` AND ad.id_ubicacion = ?`;
                params.push(ubicacionId);
            }

            sql += ` ORDER BY ad.fecha DESC, a.nombre ASC, p.nombre ASC, ad.turno ASC`;

            const result = await query(sql, params);
            asistencias = result.recordset;

            totales.registros = asistencias.length;
            totales.personas = asistencias.reduce((sum, item) => sum + (item.cantidad_asistentes || 0), 0);
        }

        return res.json({
            success: true,
            data: {
                asistencias,
                totales,
                areas: allowedAreas,
                ubicacionesFiltro,
                fechaInicio,
                fechaFin,
                selectedAreaId: areaId,
                selectedUbicacionId: ubicacionId
            }
        });
    } catch (err) {
        console.error('Error al obtener historial:', err);
        return res.status(500).json({ success: false, message: 'Error al consultar historial: ' + err.message });
    }
}

module.exports = {
    showRegistroForm,
    saveAsistencias,
    listHistorial
};
