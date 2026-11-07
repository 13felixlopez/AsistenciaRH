const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/db');

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
        const pool = await getPool();
        const result = await pool.request()
            .input('identifier', sql.VarChar, loginIdentifier)
            .query(`
                SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.password_hash, u.cargo, u.activo,
                       r.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre
                FROM Usuarios u
                INNER JOIN Roles r ON u.id_rol = r.id_rol
                WHERE LOWER(u.email) = @identifier OR LOWER(u.usuario) = @identifier
            `);

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
        await pool.request()
            .input('id', sql.Int, user.id_usuario)
            .query('UPDATE Usuarios SET ultimo_acceso = GETDATE() WHERE id_usuario = @id');

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
            const areasUsuario = await pool.request()
                .input('userId', sql.Int, user.id_usuario)
                .query(`
                    SELECT TOP 2 ua.id_area 
                    FROM Usuario_Areas ua
                    INNER JOIN Areas a ON ua.id_area = a.id_area
                    WHERE ua.id_usuario = @userId AND a.activa = 1 AND ua.permite_registro = 1
                    ORDER BY a.nombre ASC
                `);
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
        const pool = await getPool();
        const userRes = await pool.request()
            .input('id', sql.Int, user.id_usuario)
            .query(`
                SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.cargo, u.ultimo_acceso,
                       r.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre
                FROM Usuarios u
                INNER JOIN Roles r ON u.id_rol = r.id_rol
                WHERE u.id_usuario = @id
            `);

        if (userRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        return res.json({
            success: true,
            user: userRes.recordset[0]
        });
    } catch (err) {
        console.error('Error en getMe:', err);
        return res.status(500).json({ success: false, message: 'Error al obtener usuario actual' });
    }
}

// Obtener datos para vista de Perfil
async function showProfile(req, res) {
    try {
        const pool = await getPool();
        const userId = (req.user || req.session.user).id_usuario;

        const userResult = await pool.request()
            .input('id', sql.Int, userId)
            .query(`
                SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.cargo, u.fecha_creacion, u.ultimo_acceso,
                       r.nombre AS rol_nombre, r.codigo AS rol_codigo
                FROM Usuarios u
                INNER JOIN Roles r ON u.id_rol = r.id_rol
                WHERE u.id_usuario = @id
            `);

        const areasResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT a.nombre, ua.permite_registro, ua.permite_reportes
                FROM Usuario_Areas ua
                INNER JOIN Areas a ON ua.id_area = a.id_area
                WHERE ua.id_usuario = @userId
            `);

        return res.json({
            success: true,
            user: userResult.recordset[0],
            areasAsignadas: areasResult.recordset
        });
    } catch (err) {
        console.error('Error en perfil:', err);
        return res.status(500).json({ success: false, message: 'Error al cargar perfil.' });
    }
}

// Cambiar contraseña propia
async function changePassword(req, res) {
    const { actualPassword, newPassword, confirmPassword } = req.body;
    const userId = (req.user || req.session.user).id_usuario;

    if (!actualPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios.' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'La nueva contraseña y su confirmación no coinciden.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
        const pool = await getPool();
        const userRes = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT password_hash FROM Usuarios WHERE id_usuario = @id');

        if (userRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        const currentHash = userRes.recordset[0].password_hash;
        const valid = await bcrypt.compare(actualPassword, currentHash);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'La contraseña actual no es correcta.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.request()
            .input('id', sql.Int, userId)
            .input('hash', sql.VarChar, newHash)
            .query('UPDATE Usuarios SET password_hash = @hash WHERE id_usuario = @id');

        return res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (err) {
        console.error('Error al cambiar contraseña:', err);
        return res.status(500).json({ success: false, message: 'Error al actualizar contraseña.' });
    }
}

module.exports = {
    login,
    getMe,
    showProfile,
    changePassword
};
