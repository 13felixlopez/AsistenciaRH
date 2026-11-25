const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

// Middleware para verificar autenticación JWT con validación de estado activo en tiempo real
async function isAuthenticated(req, res, next) {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Acceso no autorizado: No se proporcionó token de autenticación.'
        });
    }

    try {
        const jwtSecret = process.env.JWT_SECRET || 'asistencia_jwt_secret_key_2026';
        const decoded = jwt.verify(token, jwtSecret);

        // Verificación en tiempo real de usuario activo en base de datos (revocación inmediata)
        try {
            const userCheck = await query(
                'SELECT id_usuario, activo, id_rol FROM Usuarios WHERE id_usuario = ?',
                [decoded.id_usuario]
            );

            if (userCheck.recordset.length === 0 || !userCheck.recordset[0].activo) {
                return res.status(403).json({
                    success: false,
                    message: 'Tu cuenta se encuentra inactiva o tu sesión ha sido revocada por el Administrador.',
                    revoked: true
                });
            }

            if (userCheck.recordset[0].id_rol !== decoded.id_rol) {
                decoded.id_rol = userCheck.recordset[0].id_rol;
            }
        } catch (dbErr) {
            console.warn('Advertencia en verificación de estado activo:', dbErr.message);
        }

        req.user = decoded;
        req.session = req.session || {};
        req.session.user = decoded;
        res.locals.currentUser = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Token inválido o expirado. Inicia sesión nuevamente.',
            expired: err.name === 'TokenExpiredError'
        });
    }
}

// Middleware para verificar que sea Administrador
function isAdmin(req, res, next) {
    const user = req.user || (req.session && req.session.user);
    if (user && user.rol_codigo === 'ADMIN') {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Acceso denegado: Se requieren permisos de Administrador.'
    });
}

// Helper para identificar si un usuario es de Solo Vista
function isSoloVistaUser(user) {
    if (!user) return false;
    const rol = String(user.rol_codigo || '').toUpperCase();
    return rol === 'CONSULTOR' || rol === 'SOLO_VISTA' || user.id_rol === 3;
}

// Middleware para bloquear acciones de captura a Solo Vista
function isNotSoloVista(req, res, next) {
    const user = req.user || (req.session && req.session.user);
    if (isSoloVistaUser(user)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: Los usuarios de Solo Vista no tienen permisos para capturar o modificar registros.'
        });
    }
    next();
}

// Obtener las áreas permitidas para el usuario actual
async function getUserAllowedAreas(userId, userRole) {
    const roleUpper = String(userRole || '').toUpperCase();

    // 1. Si es Administrador general, tiene acceso irrestricto a todas las áreas activas
    if (roleUpper === 'ADMIN') {
        const result = await query(`
            SELECT id_area, codigo, nombre, descripcion, activa,
                   1 AS permite_registro, 1 AS permite_reportes
            FROM Areas 
            WHERE activa = 1 
            ORDER BY nombre ASC
        `);
        return result.recordset;
    }

    // 2. Si el usuario no es admin, consultar áreas explícitamente asignadas en Usuario_Areas
    const assignedAreas = await query(`
        SELECT a.id_area, a.codigo, a.nombre, a.descripcion, a.activa,
               ua.permite_registro, ua.permite_reportes
        FROM Areas a
        INNER JOIN Usuario_Areas ua ON a.id_area = ua.id_area
        WHERE ua.id_usuario = ? AND a.activa = 1
        ORDER BY a.nombre ASC
    `, [userId]);

    return assignedAreas.recordset || [];
}

// Verificar si un usuario tiene acceso a un área específica
async function hasAreaAccess(userId, userRole, areaId, type = 'any') {
    const roleUpper = String(userRole || '').toUpperCase();
    if (roleUpper === 'ADMIN') {
        return true;
    }

    const aId = parseInt(areaId, 10);
    let sql = `
        SELECT 1 
        FROM Usuario_Areas ua
        INNER JOIN Areas a ON ua.id_area = a.id_area
        WHERE ua.id_usuario = ? AND ua.id_area = ? AND a.activa = 1
    `;
    const params = [userId, aId];

    if (type === 'registro') {
        sql += ' AND ua.permite_registro = 1';
    } else if (type === 'reporte') {
        sql += ' AND ua.permite_reportes = 1';
    }

    const result = await query(sql, params);
    return result.recordset.length > 0;
}

// Obtener las ubicaciones permitidas para un usuario dentro de un área
async function getUserAllowedLocations(userId, userRole, areaId) {
    const aId = parseInt(areaId, 10);
    const roleUpper = String(userRole || '').toUpperCase();

    if (roleUpper === 'ADMIN') {
        const result = await query(`
            SELECT id_ubicacion, id_area, codigo, nombre, descripcion, activa
            FROM Ubicaciones
            WHERE id_area = ? AND activa = 1
            ORDER BY nombre ASC
        `, [aId]);
        return result.recordset;
    }

    // Verificar si el usuario tiene asignaciones específicas de ubicación para esta área
    const countRes = await query(`
        SELECT COUNT(*) AS total
        FROM Usuario_Ubicaciones uu
        INNER JOIN Ubicaciones u ON uu.id_ubicacion = u.id_ubicacion
        WHERE uu.id_usuario = ? AND u.id_area = ? AND u.activa = 1
    `, [userId, aId]);

    const hasSpecificLocationsInArea = (countRes.recordset[0]?.total || 0) > 0;

    if (!hasSpecificLocationsInArea) {
        const result = await query(`
            SELECT id_ubicacion, id_area, codigo, nombre, descripcion, activa
            FROM Ubicaciones
            WHERE id_area = ? AND activa = 1
            ORDER BY nombre ASC
        `, [aId]);
        return result.recordset;
    }

    const result = await query(`
        SELECT u.id_ubicacion, u.id_area, u.codigo, u.nombre, u.descripcion, u.activa
        FROM Ubicaciones u
        INNER JOIN Usuario_Ubicaciones uu ON u.id_ubicacion = uu.id_ubicacion
        WHERE uu.id_usuario = ? AND u.id_area = ? AND u.activa = 1
        ORDER BY u.nombre ASC
    `, [userId, aId]);
    return result.recordset;
}

// Verificar si el usuario tiene acceso a una ubicación específica
async function hasLocationAccess(userId, userRole, areaId, locationId) {
    const roleUpper = String(userRole || '').toUpperCase();
    if (roleUpper === 'ADMIN') {
        return true;
    }

    const aId = parseInt(areaId, 10);
    const lId = locationId ? parseInt(locationId, 10) : null;

    if (!lId) {
        return hasAreaAccess(userId, userRole, aId);
    }

    // Si el usuario no tiene ubicaciones específicas asignadas para esta área, validar acceso general al área
    const countRes = await query(`
        SELECT COUNT(*) AS total
        FROM Usuario_Ubicaciones uu
        INNER JOIN Ubicaciones u ON uu.id_ubicacion = u.id_ubicacion
        WHERE uu.id_usuario = ? AND u.id_area = ? AND u.activa = 1
    `, [userId, aId]);

    const hasSpecific = (countRes.recordset[0]?.total || 0) > 0;
    if (!hasSpecific) {
        return hasAreaAccess(userId, userRole, aId);
    }

    const result = await query(`
        SELECT 1 
        FROM Usuario_Ubicaciones uu
        INNER JOIN Ubicaciones u ON uu.id_ubicacion = u.id_ubicacion
        INNER JOIN Usuario_Areas ua ON ua.id_area = u.id_area AND ua.id_usuario = uu.id_usuario
        WHERE uu.id_usuario = ? 
          AND uu.id_ubicacion = ? 
          AND u.id_area = ? 
          AND u.activa = 1
    `, [userId, lId, aId]);

    return result.recordset.length > 0;
}

module.exports = {
    isAuthenticated,
    isAdmin,
    isSoloVistaUser,
    isNotSoloVista,
    getUserAllowedAreas,
    hasAreaAccess,
    getUserAllowedLocations,
    hasLocationAccess
};
