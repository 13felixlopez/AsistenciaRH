const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../config/db');

// Mostrar vista de Login
function showLogin(req, res) {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('auth/login', {
        title: 'Iniciar Sesión | Registro de Asistencia',
        layout: 'layouts/auth',
        error: req.flash('error'),
        success: req.flash('success')
    });
}

// Procesar inicio de sesión (permite correo o nombre de usuario)
async function login(req, res) {
    const loginIdentifier = (req.body.usuario || req.body.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!loginIdentifier || !password) {
        req.flash('error', 'Por favor ingresa tu correo o nombre de usuario y contraseña.');
        return res.redirect('/auth/login');
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
            req.flash('error', 'Credenciales incorrectas o usuario no encontrado.');
            return res.redirect('/auth/login');
        }

        const user = result.recordset[0];

        if (!user.activo) {
            req.flash('error', 'Tu cuenta se encuentra inactiva. Contacta al Administrador.');
            return res.redirect('/auth/login');
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            req.flash('error', 'Credenciales incorrectas.');
            return res.redirect('/auth/login');
        }

        // Actualizar último acceso
        await pool.request()
            .input('id', sql.Int, user.id_usuario)
            .query('UPDATE Usuarios SET ultimo_acceso = GETDATE() WHERE id_usuario = @id');

        // Guardar sesión
        req.session.user = {
            id_usuario: user.id_usuario,
            nombre: user.nombre,
            usuario: user.usuario,
            email: user.email,
            cargo: user.cargo,
            id_rol: user.id_rol,
            rol_codigo: user.rol_codigo,
            rol_nombre: user.rol_nombre
        };

        req.flash('success', `¡Bienvenido(a), ${user.nombre}!`);

        const isSoloVista = user.rol_codigo === 'CONSULTOR' || user.rol_codigo === 'SOLO_VISTA' || user.id_rol === 3;

        // Redirección inteligente: Administradores al Dashboard; Solo Vista a Reportes; Registradores a Captura
        if (user.rol_codigo === 'ADMIN') {
            return res.redirect('/dashboard');
        }
        if (isSoloVista) {
            return res.redirect('/reportes');
        }

        // Obtener áreas asignadas para redirigir directamente al área de captura
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
            // Si solo tiene una única área asignada, abrir directamente los puestos de esa área
            return res.redirect(`/asistencias/registro?areaId=${areasUsuario.recordset[0].id_area}`);
        } else {
            // Si tiene varias áreas, enviarlo a la pantalla de captura para que elija
            return res.redirect('/asistencias/registro');
        }
    } catch (err) {
        console.error('Error en login:', err);
        req.flash('error', 'Ocurrió un error al procesar el inicio de sesión.');
        return res.redirect('/auth/login');
    }
}

// Cerrar sesión
function logout(req, res) {
    req.session.destroy(err => {
        if (err) console.error('Error al destruir sesión:', err);
        res.redirect('/auth/login');
    });
}

// Vista de Mi Perfil
async function showProfile(req, res) {
    try {
        const pool = await getPool();
        const userResult = await pool.request()
            .input('id', sql.Int, req.session.user.id_usuario)
            .query(`
                SELECT u.id_usuario, u.nombre, u.usuario, u.email, u.cargo, u.fecha_creacion, u.ultimo_acceso,
                       r.nombre AS rol_nombre, r.codigo AS rol_codigo
                FROM Usuarios u
                INNER JOIN Roles r ON u.id_rol = r.id_rol
                WHERE u.id_usuario = @id
            `);

        const areasResult = await pool.request()
            .input('userId', sql.Int, req.session.user.id_usuario)
            .query(`
                SELECT a.nombre, ua.permite_registro, ua.permite_reportes
                FROM Usuario_Areas ua
                INNER JOIN Areas a ON ua.id_area = a.id_area
                WHERE ua.id_usuario = @userId
            `);

        res.render('auth/perfil', {
            title: 'Mi Perfil | Registro de Asistencia',
            user: userResult.recordset[0],
            areasAsignadas: areasResult.recordset,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error en perfil:', err);
        req.flash('error', 'Error al cargar perfil.');
        res.redirect('/dashboard');
    }
}

// Cambiar contraseña propia
async function changePassword(req, res) {
    const { actualPassword, newPassword, confirmPassword } = req.body;

    if (!actualPassword || !newPassword || !confirmPassword) {
        req.flash('error', 'Todos los campos son obligatorios.');
        return res.redirect('/auth/perfil');
    }

    if (newPassword !== confirmPassword) {
        req.flash('error', 'La nueva contraseña y su confirmación no coinciden.');
        return res.redirect('/auth/perfil');
    }

    if (newPassword.length < 6) {
        req.flash('error', 'La contraseña debe tener al menos 6 caracteres.');
        return res.redirect('/auth/perfil');
    }

    try {
        const pool = await getPool();
        const userRes = await pool.request()
            .input('id', sql.Int, req.session.user.id_usuario)
            .query('SELECT password_hash FROM Usuarios WHERE id_usuario = @id');

        const currentHash = userRes.recordset[0].password_hash;
        const valid = await bcrypt.compare(actualPassword, currentHash);
        if (!valid) {
            req.flash('error', 'La contraseña actual no es correcta.');
            return res.redirect('/auth/perfil');
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.request()
            .input('id', sql.Int, req.session.user.id_usuario)
            .input('hash', sql.VarChar, newHash)
            .query('UPDATE Usuarios SET password_hash = @hash WHERE id_usuario = @id');

        req.flash('success', 'Contraseña actualizada correctamente.');
        res.redirect('/auth/perfil');
    } catch (err) {
        console.error('Error al cambiar contraseña:', err);
        req.flash('error', 'Error al actualizar contraseña.');
        res.redirect('/auth/perfil');
    }
}

module.exports = {
    showLogin,
    login,
    logout,
    showProfile,
    changePassword
};
