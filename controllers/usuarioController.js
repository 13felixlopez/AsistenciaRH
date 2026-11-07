const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../config/db');

// Listar todos los usuarios
async function listUsuarios(req, res) {
    try {
        const pool = await getPool();
        const usersResult = await pool.request().query(`
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
                    SELECT STRING_AGG(a.nombre, ', ')
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
                    SELECT STRING_AGG(CONCAT(a.nombre, ': ', ub.nombre), ' | ')
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

        res.render('usuarios/index', {
            title: 'Usuarios y Permisos | Registro de Asistencia',
            usuarios: usersResult.recordset,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al listar usuarios:', err);
        req.flash('error', 'Error al cargar los usuarios.');
        res.redirect('/dashboard');
    }
}

// Mostrar formulario para nuevo usuario
async function showCreateUser(req, res) {
    try {
        const pool = await getPool();
        const roles = await pool.request().query('SELECT id_rol, codigo, nombre, descripcion FROM Roles WHERE activo = 1 ORDER BY id_rol ASC');
        const areasRes = await pool.request().query('SELECT id_area, codigo, nombre FROM Areas WHERE activa = 1 ORDER BY nombre ASC');
        const ubicacionesRes = await pool.request().query('SELECT id_ubicacion, id_area, codigo, nombre FROM Ubicaciones WHERE activa = 1 ORDER BY nombre ASC');

        // Mapear ubicaciones a cada área
        const areas = areasRes.recordset.map(area => ({
            ...area,
            ubicaciones: ubicacionesRes.recordset.filter(u => u.id_area === area.id_area)
        }));

        res.render('usuarios/create', {
            title: 'Nuevo Usuario | Registro de Asistencia',
            roles: roles.recordset,
            areas,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al cargar formulario de usuario:', err);
        req.flash('error', 'Error al cargar formulario.');
        res.redirect('/usuarios');
    }
}

// Crear usuario y asignar áreas y ubicaciones
async function createUser(req, res) {
    const { nombre, usuario, email, password, cargo, id_rol, areas, ubicaciones } = req.body;

    const cleanUsername = (usuario || (email ? email.split('@')[0] : '')).trim().toLowerCase();

    if (!nombre || !cleanUsername || !email || !password || !id_rol) {
        req.flash('error', 'Nombre, nombre de usuario, correo electrónico, contraseña y rol son obligatorios.');
        return res.redirect('/usuarios/nuevo');
    }

    // Validar formato de username
    if (!/^[a-zA-Z0-9._-]+$/.test(cleanUsername)) {
        req.flash('error', 'El nombre de usuario solo puede contener letras, números, puntos (.), guiones (-) y guiones bajos (_).');
        return res.redirect('/usuarios/nuevo');
    }

    try {
        const pool = await getPool();

        // Verificar si el correo ya existe
        const checkEmail = await pool.request()
            .input('email', sql.VarChar, email.trim().toLowerCase())
            .query('SELECT id_usuario FROM Usuarios WHERE email = @email');

        if (checkEmail.recordset.length > 0) {
            req.flash('error', `El correo electrónico "${email}" ya está registrado.`);
            return res.redirect('/usuarios/nuevo');
        }

        // Verificar si el nombre de usuario ya existe
        const checkUser = await pool.request()
            .input('usuario', sql.VarChar, cleanUsername)
            .query('SELECT id_usuario FROM Usuarios WHERE usuario = @usuario');

        if (checkUser.recordset.length > 0) {
            req.flash('error', `El nombre de usuario "${cleanUsername}" ya está registrado.`);
            return res.redirect('/usuarios/nuevo');
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Insertar usuario
            const insertUserRes = await new sql.Request(transaction)
                .input('id_rol', sql.Int, parseInt(id_rol, 10))
                .input('nombre', sql.NVarChar, nombre.trim())
                .input('usuario', sql.VarChar, cleanUsername)
                .input('email', sql.VarChar, email.trim().toLowerCase())
                .input('hash', sql.VarChar, passwordHash)
                .input('cargo', sql.NVarChar, cargo ? cargo.trim() : null)
                .query(`
                    INSERT INTO Usuarios (id_rol, nombre, usuario, email, password_hash, cargo, activo)
                    OUTPUT INSERTED.id_usuario
                    VALUES (@id_rol, @nombre, @usuario, @email, @hash, @cargo, 1)
                `);

            const newUserId = insertUserRes.recordset[0].id_usuario;

            // Procesar asignación de áreas
            const isSoloVista = parseInt(id_rol, 10) === 3;
            const permiteRegistro = isSoloVista ? 0 : 1;
            const permiteReportes = 1;

            let selectedAreas = [];
            if (Array.isArray(areas)) {
                selectedAreas = areas;
            } else if (typeof areas === 'string') {
                selectedAreas = [areas];
            }

            for (const areaIdStr of selectedAreas) {
                const aId = parseInt(areaIdStr, 10);
                if (aId) {
                    await new sql.Request(transaction)
                        .input('userId', sql.Int, newUserId)
                        .input('areaId', sql.Int, aId)
                        .input('permiteRegistro', sql.Bit, permiteRegistro)
                        .input('permiteReportes', sql.Bit, permiteReportes)
                        .query(`
                            INSERT INTO Usuario_Areas (id_usuario, id_area, permite_registro, permite_reportes)
                            VALUES (@userId, @areaId, @permiteRegistro, @permiteReportes)
                        `);
                }
            }

            // Procesar asignación de ubicaciones específicas
            let selectedLocations = [];
            if (Array.isArray(ubicaciones)) {
                selectedLocations = ubicaciones;
            } else if (typeof ubicaciones === 'string') {
                selectedLocations = [ubicaciones];
            }

            for (const locIdStr of selectedLocations) {
                const locId = parseInt(locIdStr, 10);
                if (locId) {
                    await new sql.Request(transaction)
                        .input('userId', sql.Int, newUserId)
                        .input('locId', sql.Int, locId)
                        .query(`
                            INSERT INTO Usuario_Ubicaciones (id_usuario, id_ubicacion)
                            VALUES (@userId, @locId)
                        `);
                }
            }

            await transaction.commit();
            req.flash('success', `Usuario "${nombre}" creado exitosamente con sus áreas y ubicaciones autorizadas.`);
            res.redirect('/usuarios');
        } catch (trxError) {
            await transaction.rollback();
            throw trxError;
        }
    } catch (err) {
        console.error('Error al crear usuario:', err);
        req.flash('error', 'Error al registrar usuario: ' + err.message);
        res.redirect('/usuarios/nuevo');
    }
}

// Mostrar formulario para editar usuario y sus permisos
async function showEditUser(req, res) {
    const { id } = req.params;

    try {
        const pool = await getPool();

        const userRes = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT id_usuario, nombre, usuario, email, cargo, id_rol, activo 
                FROM Usuarios 
                WHERE id_usuario = @id
            `);

        if (userRes.recordset.length === 0) {
            req.flash('error', 'Usuario no encontrado.');
            return res.redirect('/usuarios');
        }

        const roles = await pool.request().query('SELECT id_rol, codigo, nombre, descripcion FROM Roles WHERE activo = 1 ORDER BY id_rol ASC');
        const areasRes = await pool.request().query('SELECT id_area, codigo, nombre FROM Areas WHERE activa = 1 ORDER BY nombre ASC');
        const ubicacionesRes = await pool.request().query('SELECT id_ubicacion, id_area, codigo, nombre FROM Ubicaciones WHERE activa = 1 ORDER BY nombre ASC');

        // Áreas que actualmente tiene asignadas
        const userAreasRes = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id_area, permite_registro, permite_reportes FROM Usuario_Areas WHERE id_usuario = @id');

        const assignedAreaIds = userAreasRes.recordset.map(ua => ua.id_area);

        // Ubicaciones que actualmente tiene asignadas
        const userLocationsRes = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id_ubicacion FROM Usuario_Ubicaciones WHERE id_usuario = @id');

        const assignedLocationIds = userLocationsRes.recordset.map(ul => ul.id_ubicacion);

        // Mapear ubicaciones a cada área
        const areas = areasRes.recordset.map(area => ({
            ...area,
            ubicaciones: ubicacionesRes.recordset.filter(u => u.id_area === area.id_area)
        }));

        res.render('usuarios/edit', {
            title: 'Editar Usuario | Registro de Asistencia',
            user: userRes.recordset[0],
            roles: roles.recordset,
            areas,
            assignedAreaIds,
            assignedLocationIds,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error('Error al cargar edición de usuario:', err);
        req.flash('error', 'Error al obtener datos del usuario.');
        res.redirect('/usuarios');
    }
}

// Guardar cambios en usuario y permisos
async function updateUser(req, res) {
    const { id } = req.params;
    const { nombre, usuario, email, password, cargo, id_rol, activo, areas, ubicaciones } = req.body;

    const cleanUsername = (usuario || (email ? email.split('@')[0] : '')).trim().toLowerCase();

    if (!nombre || !cleanUsername || !email || !id_rol) {
        req.flash('error', 'Nombre, nombre de usuario, correo y rol son obligatorios.');
        return res.redirect(`/usuarios/editar/${id}`);
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(cleanUsername)) {
        req.flash('error', 'El nombre de usuario solo puede contener letras, números, puntos (.), guiones (-) y guiones bajos (_).');
        return res.redirect(`/usuarios/editar/${id}`);
    }

    try {
        const pool = await getPool();

        // Verificar que el correo no esté tomado por otro usuario
        const checkEmail = await pool.request()
            .input('id', sql.Int, id)
            .input('email', sql.VarChar, email.trim().toLowerCase())
            .query('SELECT id_usuario FROM Usuarios WHERE email = @email AND id_usuario != @id');

        if (checkEmail.recordset.length > 0) {
            req.flash('error', `El correo electrónico "${email}" ya está en uso.`);
            return res.redirect(`/usuarios/editar/${id}`);
        }

        // Verificar que el nombre de usuario no esté tomado por otro usuario
        const checkUser = await pool.request()
            .input('id', sql.Int, id)
            .input('usuario', sql.VarChar, cleanUsername)
            .query('SELECT id_usuario FROM Usuarios WHERE usuario = @usuario AND id_usuario != @id');

        if (checkUser.recordset.length > 0) {
            req.flash('error', `El nombre de usuario "${cleanUsername}" ya está en uso.`);
            return res.redirect(`/usuarios/editar/${id}`);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Actualizar datos generales
            let updateQuery = `
                UPDATE Usuarios 
                SET nombre = @nombre,
                    usuario = @usuario,
                    email = @email,
                    cargo = @cargo,
                    id_rol = @id_rol,
                    activo = @activo
            `;

            const reqUpdate = new sql.Request(transaction)
                .input('id', sql.Int, id)
                .input('nombre', sql.NVarChar, nombre.trim())
                .input('usuario', sql.VarChar, cleanUsername)
                .input('email', sql.VarChar, email.trim().toLowerCase())
                .input('cargo', sql.NVarChar, cargo ? cargo.trim() : null)
                .input('id_rol', sql.Int, parseInt(id_rol, 10))
                .input('activo', sql.Bit, activo ? 1 : 0);

            // Si se suministró nueva contraseña
            if (password && password.trim().length > 0) {
                const newHash = await bcrypt.hash(password.trim(), 10);
                updateQuery += `, password_hash = @password_hash `;
                reqUpdate.input('password_hash', sql.VarChar, newHash);
            }

            updateQuery += ` WHERE id_usuario = @id`;
            await reqUpdate.query(updateQuery);

            // Reemplazar asignación de áreas
            await new sql.Request(transaction)
                .input('id', sql.Int, id)
                .query('DELETE FROM Usuario_Areas WHERE id_usuario = @id');

            const isSoloVista = parseInt(id_rol, 10) === 3;
            const permiteRegistro = isSoloVista ? 0 : 1;
            const permiteReportes = 1;

            let selectedAreas = [];
            if (Array.isArray(areas)) {
                selectedAreas = areas;
            } else if (typeof areas === 'string') {
                selectedAreas = [areas];
            }

            for (const areaIdStr of selectedAreas) {
                const aId = parseInt(areaIdStr, 10);
                if (aId) {
                    await new sql.Request(transaction)
                        .input('userId', sql.Int, id)
                        .input('areaId', sql.Int, aId)
                        .input('permiteRegistro', sql.Bit, permiteRegistro)
                        .input('permiteReportes', sql.Bit, permiteReportes)
                        .query(`
                            INSERT INTO Usuario_Areas (id_usuario, id_area, permite_registro, permite_reportes)
                            VALUES (@userId, @areaId, @permiteRegistro, @permiteReportes)
                        `);
                }
            }

            // Reemplazar asignación de ubicaciones
            await new sql.Request(transaction)
                .input('id', sql.Int, id)
                .query('DELETE FROM Usuario_Ubicaciones WHERE id_usuario = @id');

            let selectedLocations = [];
            if (Array.isArray(ubicaciones)) {
                selectedLocations = ubicaciones;
            } else if (typeof ubicaciones === 'string') {
                selectedLocations = [ubicaciones];
            }

            for (const locIdStr of selectedLocations) {
                const locId = parseInt(locIdStr, 10);
                if (locId) {
                    await new sql.Request(transaction)
                        .input('userId', sql.Int, id)
                        .input('locId', sql.Int, locId)
                        .query(`
                            INSERT INTO Usuario_Ubicaciones (id_usuario, id_ubicacion)
                            VALUES (@userId, @locId)
                        `);
                }
            }

            await transaction.commit();
            req.flash('success', `Usuario "${nombre}" actualizado correctamente.`);
            res.redirect('/usuarios');
        } catch (trxError) {
            await transaction.rollback();
            throw trxError;
        }
    } catch (err) {
        console.error('Error al actualizar usuario:', err);
        req.flash('error', 'Error al modificar usuario: ' + err.message);
        res.redirect(`/usuarios/editar/${id}`);
    }
}

// Alternar estado activo / inactivo
async function toggleUserStatus(req, res) {
    const { id } = req.params;
    const currentUserId = req.session.user.id_usuario;

    if (parseInt(id, 10) === currentUserId) {
        req.flash('error', 'No puedes desactivar tu propia cuenta en sesión.');
        return res.redirect('/usuarios');
    }

    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Usuarios SET activo = ~activo WHERE id_usuario = @id');

        req.flash('success', 'Estado del usuario actualizado correctamente.');
        res.redirect('/usuarios');
    } catch (err) {
        console.error('Error al alternar estado de usuario:', err);
        req.flash('error', 'Error al modificar estado.');
        res.redirect('/usuarios');
    }
}

module.exports = {
    listUsuarios,
    showCreateUser,
    createUser,
    showEditUser,
    updateUser,
    toggleUserStatus
};
