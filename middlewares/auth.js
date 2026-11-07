const { getPool, sql } = require('../config/db');

// Middleware para verificar que el usuario esté autenticado
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        res.locals.currentUser = req.session.user;
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ success: false, message: 'Sesión expirada o no autenticado.' });
    }
    req.flash('error', 'Debes iniciar sesión para continuar.');
    return res.redirect('/auth/login');
}

// Middleware para verificar que sea Administrador
function isAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.rol_codigo === 'ADMIN') {
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(403).json({ success: false, message: 'Acceso denegado: Se requieren permisos de Administrador.' });
    }
    req.flash('error', 'Acceso denegado: Requiere permisos de Administrador.');
    return res.redirect('/dashboard');
}

// Helper para identificar si un usuario es de Solo Vista (Consultor)
function isSoloVistaUser(user) {
    if (!user) return false;
    const rol = String(user.rol_codigo || '').toUpperCase();
    return rol === 'CONSULTOR' || rol === 'SOLO_VISTA' || user.id_rol === 3;
}

// Middleware para bloquear acciones de escritura a usuarios de Solo Vista
function isNotSoloVista(req, res, next) {
    const user = req.session && req.session.user;
    if (isSoloVistaUser(user)) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado: Los usuarios de Solo Vista no tienen permisos para capturar o modificar registros.'
            });
        }
        req.flash('error', 'Acceso denegado: Tu perfil es de Solo Vista y no tienes permiso para capturar o modificar asistencias.');
        return res.redirect('/reportes');
    }
    next();
}

// Obtener las áreas permitidas para el usuario actual
async function getUserAllowedAreas(userId, userRole) {
    const pool = await getPool();

    // 1. Si el usuario tiene áreas explícitamente asignadas en Usuario_Areas, respetarlas estrictamente
    const assignedAreas = await pool.request()
        .input('userId', sql.Int, userId)
        .query(`
            SELECT a.id_area, a.codigo, a.nombre, a.descripcion, a.activa,
                   ua.permite_registro, ua.permite_reportes
            FROM Areas a
            INNER JOIN Usuario_Areas ua ON a.id_area = ua.id_area
            WHERE ua.id_usuario = @userId AND a.activa = 1
            ORDER BY a.nombre ASC
        `);

    if (assignedAreas.recordset.length > 0) {
        return assignedAreas.recordset;
    }

    // 2. Si no tiene asignación específica pero es Administrador general, ve todas las áreas activas
    if (userRole === 'ADMIN') {
        const result = await pool.request().query(`
            SELECT id_area, codigo, nombre, descripcion, activa,
                   1 AS permite_registro, 1 AS permite_reportes
            FROM Areas 
            WHERE activa = 1 
            ORDER BY nombre ASC
        `);
        return result.recordset;
    }

    // Usuario estándar sin áreas asignadas
    return [];
}

// Verificar si un usuario tiene acceso a un área específica
async function hasAreaAccess(userId, userRole, areaId, type = 'any') {
    const pool = await getPool();
    const aId = parseInt(areaId, 10);

    // Verificar si el usuario tiene asignaciones explícitas en Usuario_Areas
    const countRes = await pool.request()
        .input('userId', sql.Int, userId)
        .query('SELECT COUNT(*) AS total FROM Usuario_Areas WHERE id_usuario = @userId');

    const hasSpecificAssignments = countRes.recordset[0].total > 0;

    // Solo un ADMIN sin áreas asignadas específicas tiene acceso irrestricto global
    if (userRole === 'ADMIN' && !hasSpecificAssignments) {
        return true;
    }

    let query = `
        SELECT 1 
        FROM Usuario_Areas ua
        INNER JOIN Areas a ON ua.id_area = a.id_area
        WHERE ua.id_usuario = @userId AND ua.id_area = @areaId AND a.activa = 1
    `;
    if (type === 'registro') {
        query += ' AND ua.permite_registro = 1';
    } else if (type === 'reporte') {
        query += ' AND ua.permite_reportes = 1';
    }

    const result = await pool.request()
        .input('userId', sql.Int, userId)
        .input('areaId', sql.Int, aId)
        .query(query);

    return result.recordset.length > 0;
}

// Obtener las ubicaciones permitidas para un usuario dentro de un área
async function getUserAllowedLocations(userId, userRole, areaId) {
    const pool = await getPool();
    const aId = parseInt(areaId, 10);

    // Verificar si el usuario tiene ubicaciones explícitas asignadas
    const countRes = await pool.request()
        .input('userId', sql.Int, userId)
        .query('SELECT COUNT(*) AS total FROM Usuario_Ubicaciones WHERE id_usuario = @userId');

    const hasSpecificLocations = countRes.recordset[0].total > 0;

    if (userRole === 'ADMIN' && !hasSpecificLocations) {
        // Admin global ve todas las ubicaciones activas del área
        const result = await pool.request()
            .input('areaId', sql.Int, aId)
            .query(`
                SELECT id_ubicacion, id_area, codigo, nombre, descripcion, activa
                FROM Ubicaciones
                WHERE id_area = @areaId AND activa = 1
                ORDER BY nombre ASC
            `);
        return result.recordset;
    } else {
        // Usuario ve solo las ubicaciones asignadas explícitamente en Usuario_Ubicaciones
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('areaId', sql.Int, aId)
            .query(`
                SELECT u.id_ubicacion, u.id_area, u.codigo, u.nombre, u.descripcion, u.activa
                FROM Ubicaciones u
                INNER JOIN Usuario_Ubicaciones uu ON u.id_ubicacion = uu.id_ubicacion
                WHERE uu.id_usuario = @userId AND u.id_area = @areaId AND u.activa = 1
                ORDER BY u.nombre ASC
            `);
        return result.recordset;
    }
}

// Verificar si el usuario tiene acceso a una ubicación específica
async function hasLocationAccess(userId, userRole, areaId, locationId) {
    const pool = await getPool();
    const aId = parseInt(areaId, 10);
    const lId = locationId ? parseInt(locationId, 10) : null;

    const countRes = await pool.request()
        .input('userId', sql.Int, userId)
        .query('SELECT COUNT(*) AS total FROM Usuario_Ubicaciones WHERE id_usuario = @userId');

    const hasSpecificLocations = countRes.recordset[0].total > 0;
    if (userRole === 'ADMIN' && !hasSpecificLocations) {
        return true;
    }

    if (!lId) {
        return hasAreaAccess(userId, userRole, aId);
    }

    const result = await pool.request()
        .input('userId', sql.Int, userId)
        .input('areaId', sql.Int, aId)
        .input('locationId', sql.Int, lId)
        .query(`
            SELECT 1 
            FROM Usuario_Ubicaciones uu
            INNER JOIN Ubicaciones u ON uu.id_ubicacion = u.id_ubicacion
            INNER JOIN Usuario_Areas ua ON ua.id_area = u.id_area AND ua.id_usuario = uu.id_usuario
            WHERE uu.id_usuario = @userId 
              AND uu.id_ubicacion = @locationId 
              AND u.id_area = @areaId 
              AND u.activa = 1
        `);

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
