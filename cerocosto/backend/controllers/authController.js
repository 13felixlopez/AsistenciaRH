const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, initDatabase } = require('../config/db');

// Iniciar sesión y retornar JWT
async function login(req, res) {
    const loginIdentifier = (req.body.usuario || req.body.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!loginIdentifier || !password) {
        return res.status(400).json({
            success: false,
            message: 'Por favor ingresa tu correo o nombre de usuario y contraseña.'
        });
    }

    try {
        let result;
        try {
            result = await query(`
                SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.password_hash, u.cargo, u.activo,
                       r.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre
                FROM Usuarios u
                INNER JOIN Roles r ON u.id_rol = r.id_rol
                WHERE LOWER(u.email) = ? OR LOWER(u.usuario) = ?
            `, [loginIdentifier, loginIdentifier]);
        } catch (dbErr) {
            if (dbErr.message && (dbErr.message.includes('no such table') || dbErr.message.includes('not found'))) {
                console.log('🔄 Tablas no encontradas en Turso. Auto-inicializando esquema...');
                await initDatabase();
                result = await query(`
                    SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.password_hash, u.cargo, u.activo,
                           r.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre
                    FROM Usuarios u
                    INNER JOIN Roles r ON u.id_rol = r.id_rol
                    WHERE LOWER(u.email) = ? OR LOWER(u.usuario) = ?
                `, [loginIdentifier, loginIdentifier]);
            } else {
                throw dbErr;
            }
        }

        if (result.recordset.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales incorrectas o usuario no encontrado.'
            });
        }

        const user = result.recordset[0];

        if (!user.activo) {
            return res.status(403).json({
                success: false,
                message: 'Tu cuenta se encuentra inactiva. Contacta al Administrador.'
            });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales incorrectas.'
            });
        }

        // Actualizar último acceso
        await query(
            "UPDATE Usuarios SET ultimo_acceso = datetime('now', 'localtime') WHERE id_usuario = ?",
            [user.id_usuario]
        );

        // Generar payload de token JWT
        const userPayload = {
            id_usuario: user.id_usuario,
            nombre: user.nombre,
            usuario: user.usuario,
            email: user.email,
            cargo: user.cargo,
            id_rol: user.id_rol,
            rol_codigo: user.rol_codigo,
            rol_nombre: user.rol_nombre
        };

        const token = jwt.sign(
            userPayload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
        );

        // Obtener áreas asignadas para guiar la redirección inteligente en el frontend
        let defaultAreaId = null;
        if (user.rol_codigo !== 'ADMIN') {
            const areasUsuario = await query(`
                SELECT ua.id_area 
                FROM Usuario_Areas ua
                INNER JOIN Areas a ON ua.id_area = a.id_area
                WHERE ua.id_usuario = ? AND a.activa = 1 AND ua.permite_registro = 1
                ORDER BY a.nombre ASC
                LIMIT 2
            `, [user.id_usuario]);

            if (areasUsuario.recordset.length === 1) {
                defaultAreaId = areasUsuario.recordset[0].id_area;
            }
        }

        const isSoloVista = user.rol_codigo === 'CONSULTOR' || user.rol_codigo === 'SOLO_VISTA' || user.id_rol === 3;

        let redirectUrl = '/asistencias-registro.html';
        if (user.rol_codigo === 'ADMIN') {
            redirectUrl = '/dashboard.html';
        } else if (isSoloVista) {
            redirectUrl = '/reportes.html';
        } else if (defaultAreaId) {
            redirectUrl = `/asistencias-registro.html?areaId=${defaultAreaId}`;
        }

        return res.json({
            success: true,
            message: `¡Bienvenido(a), ${user.nombre}!`,
            token,
            user: userPayload,
            redirect: redirectUrl
        });
    } catch (err) {
        console.error('Error en login:', err);
        return res.status(500).json({
            success: false,
            message: 'Ocurrió un error al procesar el inicio de sesión.'
        });
    }
}

// Obtener datos del usuario autenticado (Me)
async function getMe(req, res) {
    try {
        const user = req.user;
        const userRes = await query(`
            SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.cargo, u.ultimo_acceso,
                   r.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre
            FROM Usuarios u
            INNER JOIN Roles r ON u.id_rol = r.id_rol
            WHERE u.id_usuario = ?
        `, [user.id_usuario]);

        if (userRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        const u = userRes.recordset[0];

        // Obtener áreas
        const areasRes = await query(`
            SELECT a.id_area, a.codigo, a.nombre, ua.permite_registro, ua.permite_reportes
            FROM Usuario_Areas ua
            INNER JOIN Areas a ON ua.id_area = a.id_area
            WHERE ua.id_usuario = ? AND a.activa = 1
            ORDER BY a.nombre ASC
        `, [user.id_usuario]);

        return res.json({
            success: true,
            user: {
                ...u,
                areas: areasRes.recordset
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

// Actualizar perfil del usuario autenticado
async function updateProfile(req, res) {
    const user = req.user;
    const { nombre, email, passwordActual, passwordNuevo } = req.body;

    if (!nombre || !email) {
        return res.status(400).json({ success: false, message: 'Nombre y correo son obligatorios.' });
    }

    try {
        // Verificar correo duplicado
        const check = await query(
            'SELECT id_usuario FROM Usuarios WHERE email = ? AND id_usuario != ?',
            [email.trim().toLowerCase(), user.id_usuario]
        );

        if (check.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'El correo electrónico ya está en uso por otro usuario.' });
        }

        // Si desea cambiar contraseña
        if (passwordNuevo) {
            if (!passwordActual) {
                return res.status(400).json({ success: false, message: 'Debes proporcionar tu contraseña actual para cambiarla.' });
            }

            const current = await query('SELECT password_hash FROM Usuarios WHERE id_usuario = ?', [user.id_usuario]);
            const match = await bcrypt.compare(passwordActual, current.recordset[0].password_hash);

            if (!match) {
                return res.status(400).json({ success: false, message: 'La contraseña actual no es correcta.' });
            }

            const newHash = await bcrypt.hash(passwordNuevo.trim(), 10);
            await query(`
                UPDATE Usuarios 
                SET nombre = ?, email = ?, password_hash = ?
                WHERE id_usuario = ?
            `, [nombre.trim(), email.trim().toLowerCase(), newHash, user.id_usuario]);
        } else {
            await query(`
                UPDATE Usuarios 
                SET nombre = ?, email = ?
                WHERE id_usuario = ?
            `, [nombre.trim(), email.trim().toLowerCase(), user.id_usuario]);
        }

        return res.json({
            success: true,
            message: 'Perfil actualizado correctamente.'
        });
    } catch (err) {
        console.error('Error al actualizar perfil:', err);
        return res.status(500).json({ success: false, message: 'Error al actualizar perfil: ' + err.message });
    }
}

module.exports = {
    login,
    getMe,
    updateProfile
};
