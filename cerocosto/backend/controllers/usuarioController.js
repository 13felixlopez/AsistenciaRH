const bcrypt = require('bcryptjs');
const { query } = require('../config/db');

// Listar todos los usuarios
async function listUsuarios(req, res) {
    try {
        const usersResult = await query(`
            SELECT 
                u.id_usuario,
                u.nombre,
                u.usuario,
                u.email,
                u.cargo,
                u.activo,
                u.fecha_creacion,
                u.ultimo_acceso,
                r.id_rol,
                r.codigo AS rol_codigo,
                r.nombre AS rol_nombre,
                (
                    SELECT GROUP_CONCAT(a.nombre, ', ')
                    FROM Usuario_Areas ua
                    INNER JOIN Areas a ON ua.id_area = a.id_area
                    WHERE ua.id_usuario = u.id_usuario
                ) AS areas_asignadas,
                (
                    SELECT COUNT(*) 
                    FROM Usuario_Areas ua 
                    WHERE ua.id_usuario = u.id_usuario
                ) AS total_areas_asignadas,
                (
                    SELECT GROUP_CONCAT(a.nombre || ': ' || ub.nombre, ' | ')
                    FROM Usuario_Ubicaciones uu
                    INNER JOIN Ubicaciones ub ON uu.id_ubicacion = ub.id_ubicacion
                    INNER JOIN Areas a ON ub.id_area = a.id_area
                    WHERE uu.id_usuario = u.id_usuario
                ) AS ubicaciones_asignadas,
                (
                    SELECT COUNT(*) 
                    FROM Usuario_Ubicaciones uu 
                    WHERE uu.id_usuario = u.id_usuario
                ) AS total_ubicaciones_asignadas
            FROM Usuarios u
            INNER JOIN Roles r ON u.id_rol = r.id_rol
            ORDER BY u.nombre ASC
        `);

        return res.json({
            success: true,
            usuarios: usersResult.recordset
        });
    } catch (err) {
        console.error('Error al listar usuarios:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar los usuarios.'
        });
    }
}

// Obtener datos para formulario de usuario (catálogos y asignaciones)
async function getUserFormData(req, res) {
    const userId = req.params.id ? parseInt(req.params.id, 10) : null;

    try {
        const roles = await query('SELECT id_rol, codigo, nombre, descripcion FROM Roles WHERE activo = 1 ORDER BY id_rol ASC');
        const areasRes = await query('SELECT id_area, codigo, nombre FROM Areas WHERE activa = 1 ORDER BY nombre ASC');
        const ubicacionesRes = await query('SELECT id_ubicacion, id_area, codigo, nombre FROM Ubicaciones WHERE activa = 1 ORDER BY nombre ASC');

        const areas = areasRes.recordset.map(area => ({
            ...area,
            ubicaciones: ubicacionesRes.recordset.filter(u => u.id_area === area.id_area)
        }));

        let user = null;
        let assignedAreaIds = [];
        let assignedLocationIds = [];

        if (userId) {
            const uRes = await query(`
                SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.cargo, u.activo, u.id_rol,
                       r.codigo AS rol_codigo, r.nombre AS rol_nombre
                FROM Usuarios u
                INNER JOIN Roles r ON u.id_rol = r.id_rol
                WHERE u.id_usuario = ?
            `, [userId]);

            if (uRes.recordset.length > 0) {
                user = uRes.recordset[0];
                const uaRes = await query('SELECT id_area FROM Usuario_Areas WHERE id_usuario = ?', [userId]);
                assignedAreaIds = uaRes.recordset.map(r => r.id_area);

                const uuRes = await query('SELECT id_ubicacion FROM Usuario_Ubicaciones WHERE id_usuario = ?', [userId]);
                assignedLocationIds = uuRes.recordset.map(r => r.id_ubicacion);
            }
        }

        return res.json({
            success: true,
            roles: roles.recordset,
            areas,
            user,
            assignedAreaIds,
            assignedLocationIds
        });
    } catch (err) {
        console.error('Error al obtener catálogos de usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cargar opciones de usuario.'
        });
    }
}

// Crear usuario y asignar áreas
async function createUser(req, res) {
    const { nombre, usuario, email, password, cargo, id_rol, areas, ubicaciones } = req.body;

    const cleanUsername = (usuario || (email ? email.split('@')[0] : '')).trim().toLowerCase();

    if (!nombre || !cleanUsername || !email || !password || !id_rol) {
        return res.status(400).json({
            success: false,
            message: 'Nombre, nombre de usuario, correo electrónico, contraseña y rol son obligatorios.'
        });
    }

    try {
        const check = await query(
            'SELECT id_usuario FROM Usuarios WHERE LOWER(email) = ? OR LOWER(usuario) = ?',
            [email.trim().toLowerCase(), cleanUsername]
        );

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un usuario con ese correo electrónico o nombre de usuario.'
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const userInsert = await query(`
            INSERT INTO Usuarios (nombre, usuario, email, password_hash, cargo, id_rol, activo)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            RETURNING id_usuario
        `, [nombre.trim(), cleanUsername, email.trim().toLowerCase(), passwordHash, cargo ? cargo.trim() : null, parseInt(id_rol, 10)]);

        const newUserId = userInsert.recordset[0]?.id_usuario || userInsert.lastInsertRowid;

        // Asignar áreas
        const isSoloVista = parseInt(id_rol, 10) === 3;
        const permiteRegistro = isSoloVista ? 0 : 1;
        const permiteReportes = 1;

        let selectedAreas = Array.isArray(areas) ? areas : (areas ? [areas] : []);
        for (const areaIdStr of selectedAreas) {
            const aId = parseInt(areaIdStr, 10);
            if (aId) {
                await query(`
                    INSERT INTO Usuario_Areas (id_usuario, id_area, permite_registro, permite_reportes)
                    VALUES (?, ?, ?, ?)
                `, [newUserId, aId, permiteRegistro, permiteReportes]);
            }
        }

        // Asignar ubicaciones
        let selectedLocations = Array.isArray(ubicaciones) ? ubicaciones : (ubicaciones ? [ubicaciones] : []);
        for (const locIdStr of selectedLocations) {
            const locId = parseInt(locIdStr, 10);
            if (locId) {
                await query(`
                    INSERT INTO Usuario_Ubicaciones (id_usuario, id_ubicacion)
                    VALUES (?, ?)
                `, [newUserId, locId]);
            }
        }

        return res.status(201).json({
            success: true,
            message: `Usuario "${nombre}" creado exitosamente.`,
            id_usuario: newUserId
        });
    } catch (err) {
        console.error('Error al crear usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al registrar usuario: ' + err.message
        });
    }
}

// Editar usuario
async function updateUser(req, res) {
    const { id } = req.params;
    const { nombre, usuario, email, password, cargo, id_rol, activo, areas, ubicaciones } = req.body;

    const cleanUsername = (usuario || (email ? email.split('@')[0] : '')).trim().toLowerCase();

    if (!id || !nombre || !cleanUsername || !email || !id_rol) {
        return res.status(400).json({
            success: false,
            message: 'Nombre, nombre de usuario, correo electrónico y rol son obligatorios.'
        });
    }

    try {
        const check = await query(
            'SELECT id_usuario FROM Usuarios WHERE (LOWER(email) = ? OR LOWER(usuario) = ?) AND id_usuario != ?',
            [email.trim().toLowerCase(), cleanUsername, id]
        );

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'El correo electrónico o nombre de usuario ya está en uso por otra cuenta.'
            });
        }

        if (password && password.trim().length > 0) {
            const passwordHash = await bcrypt.hash(password.trim(), 10);
            await query(`
                UPDATE Usuarios 
                SET nombre = ?, usuario = ?, email = ?, cargo = ?, id_rol = ?, activo = ?, password_hash = ?
                WHERE id_usuario = ?
            `, [nombre.trim(), cleanUsername, email.trim().toLowerCase(), cargo ? cargo.trim() : null, parseInt(id_rol, 10), activo ? 1 : 0, passwordHash, id]);
        } else {
            await query(`
                UPDATE Usuarios 
                SET nombre = ?, usuario = ?, email = ?, cargo = ?, id_rol = ?, activo = ?
                WHERE id_usuario = ?
            `, [nombre.trim(), cleanUsername, email.trim().toLowerCase(), cargo ? cargo.trim() : null, parseInt(id_rol, 10), activo ? 1 : 0, id]);
        }

        // Reemplazar asignación de áreas
        await query('DELETE FROM Usuario_Areas WHERE id_usuario = ?', [id]);

        const isSoloVista = parseInt(id_rol, 10) === 3;
        const permiteRegistro = isSoloVista ? 0 : 1;
        const permiteReportes = 1;

        let selectedAreas = Array.isArray(areas) ? areas : (areas ? [areas] : []);
        for (const areaIdStr of selectedAreas) {
            const aId = parseInt(areaIdStr, 10);
            if (aId) {
                await query(`
                    INSERT INTO Usuario_Areas (id_usuario, id_area, permite_registro, permite_reportes)
                    VALUES (?, ?, ?, ?)
                `, [id, aId, permiteRegistro, permiteReportes]);
            }
        }

        // Reemplazar asignación de ubicaciones
        await query('DELETE FROM Usuario_Ubicaciones WHERE id_usuario = ?', [id]);

        let selectedLocations = Array.isArray(ubicaciones) ? ubicaciones : (ubicaciones ? [ubicaciones] : []);
        for (const locIdStr of selectedLocations) {
            const locId = parseInt(locIdStr, 10);
            if (locId) {
                await query(`
                    INSERT INTO Usuario_Ubicaciones (id_usuario, id_ubicacion)
                    VALUES (?, ?)
                `, [id, locId]);
            }
        }

        return res.json({
            success: true,
            message: `Usuario "${nombre}" actualizado correctamente.`
        });
    } catch (err) {
        console.error('Error al actualizar usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al modificar el usuario: ' + err.message
        });
    }
}

// Activar o desactivar usuario
async function toggleUserStatus(req, res) {
    const { id } = req.params;
    try {
        const result = await query(`
            UPDATE Usuarios 
            SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END 
            WHERE id_usuario = ? 
            RETURNING activo
        `, [id]);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        return res.json({
            success: true,
            message: 'Estado del usuario actualizado.',
            activo: result.recordset[0].activo
        });
    } catch (err) {
        console.error('Error al alternar estado del usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al cambiar el estado del usuario.'
        });
    }
}

module.exports = {
    listUsuarios,
    getUserFormData,
    createUser,
    updateUser,
    toggleUserStatus
};
