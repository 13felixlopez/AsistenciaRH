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

// Obtener datos auxiliares para creación/edición (Roles, Áreas y Ubicaciones, y datos de usuario si se pasa id)
async function getUserFormData(req, res) {
    const id = req.params.id ? parseInt(req.params.id, 10) : null;

    try {
        const pool = await getPool();
        const rolesRes = await pool.request().query('SELECT id_rol, codigo, nombre, descripcion FROM Roles WHERE activo = 1 ORDER BY id_rol ASC');
        const areasRes = await pool.request().query('SELECT id_area, codigo, nombre FROM Areas WHERE activa = 1 ORDER BY nombre ASC');
        const ubicacionesRes = await pool.request().query('SELECT id_ubicacion, id_area, codigo, nombre FROM Ubicaciones WHERE activa = 1 ORDER BY nombre ASC');

        const areas = areasRes.recordset.map(area => ({
            ...area,
            ubicaciones: ubicacionesRes.recordset.filter(u => u.id_area === area.id_area)
        }));

        let userData = null;
        let assignedAreaIds = [];
        let assignedLocationIds = [];

        if (id) {
            const userRes = await pool.request()
                .input('id', sql.Int, id)
                .query(`
                    SELECT id_usuario, nombre, usuario, email, cargo, id_rol, activo 
                    FROM Usuarios 
                    WHERE id_usuario = @id
                `);

            if (userRes.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
            }

            userData = userRes.recordset[0];

            const userAreasRes = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT id_area FROM Usuario_Areas WHERE id_usuario = @id');
            assignedAreaIds = userAreasRes.recordset.map(ua => ua.id_area);

            const userLocationsRes = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT id_ubicacion FROM Usuario_Ubicaciones WHERE id_usuario = @id');
            assignedLocationIds = userLocationsRes.recordset.map(ul => ul.id_ubicacion);
        }

        return res.json({
            success: true,
            roles: rolesRes.recordset,
            areas,
            user: userData,
            assignedAreaIds,
            assignedLocationIds
        });
    } catch (err) {
        console.error('Error al obtener datos de formulario de usuario:', err);
        return res.status(500).json({ success: false, message: 'Error interno: ' + err.message });
    }
}

// Crear usuario y asignar áreas y ubicaciones
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
        const pool = await getPool();

        // Validar unicidad de correo y nombre de usuario
        const check = await pool.request()
            .input('email', sql.VarChar, email.trim().toLowerCase())
            .input('usuario', sql.VarChar, cleanUsername)
            .query('SELECT id_usuario FROM Usuarios WHERE LOWER(email) = @email OR LOWER(usuario) = @usuario');

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un usuario con ese correo electrónico o nombre de usuario.'
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const userInsert = await new sql.Request(transaction)
                .input('nombre', sql.NVarChar, nombre.trim())
                .input('usuario', sql.VarChar, cleanUsername)
                .input('email', sql.VarChar, email.trim().toLowerCase())
                .input('password', sql.VarChar, passwordHash)
                .input('cargo', sql.NVarChar, cargo ? cargo.trim() : null)
                .input('id_rol', sql.Int, parseInt(id_rol, 10))
                .query(`
                    INSERT INTO Usuarios (nombre, usuario, email, password_hash, cargo, id_rol, activo)
                    OUTPUT INSERTED.id_usuario
                    VALUES (@nombre, @usuario, @email, @password, @cargo, @id_rol, 1)
                `);

            const newUserId = userInsert.recordset[0].id_usuario;

            // Asignar áreas
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

            // Asignar ubicaciones
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
            return res.status(201).json({
                success: true,
                message: `Usuario "${nombre}" creado exitosamente con sus áreas y ubicaciones autorizadas.`,
                id_usuario: newUserId
            });
        } catch (trxError) {
            await transaction.rollback();
            throw trxError;
        }
    } catch (err) {
        console.error('Error al crear usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al registrar usuario: ' + err.message
        });
    }
}

// Actualizar usuario existente
async function updateUser(req, res) {
    const { id } = req.params;
    const { nombre, usuario, email, password, cargo, id_rol, activo, areas, ubicaciones } = req.body;
    const cleanUsername = (usuario || (email ? email.split('@')[0] : '')).trim().toLowerCase();

    if (!nombre || !cleanUsername || !email || !id_rol) {
        return res.status(400).json({
            success: false,
            message: 'Nombre, nombre de usuario, correo y rol son obligatorios.'
        });
    }

    try {
        const pool = await getPool();

        // Validar unicidad excluyendo el actual
        const check = await pool.request()
            .input('id', sql.Int, id)
            .input('email', sql.VarChar, email.trim().toLowerCase())
            .input('usuario', sql.VarChar, cleanUsername)
            .query('SELECT id_usuario FROM Usuarios WHERE (LOWER(email) = @email OR LOWER(usuario) = @usuario) AND id_usuario != @id');

        if (check.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe otro usuario con ese correo electrónico o nombre de usuario.'
            });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
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
                .input('activo', sql.Bit, (activo === 1 || activo === '1' || activo === true || activo === 'true' || activo === 'on') ? 1 : 0);

            if (password && password.trim().length > 0) {
                const passwordHash = await bcrypt.hash(password.trim(), 10);
                updateQuery += `, password_hash = @password`;
                reqUpdate.input('password', sql.VarChar, passwordHash);
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
            return res.json({
                success: true,
                message: `Usuario "${nombre}" actualizado correctamente.`
            });
        } catch (trxError) {
            await transaction.rollback();
            throw trxError;
        }
    } catch (err) {
        console.error('Error al actualizar usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al modificar usuario: ' + err.message
        });
    }
}

// Alternar estado activo / inactivo
async function toggleUserStatus(req, res) {
    const { id } = req.params;
    const currentUserId = (req.user || req.session.user).id_usuario;

    if (parseInt(id, 10) === currentUserId) {
        return res.status(400).json({
            success: false,
            message: 'No puedes desactivar tu propia cuenta en sesión.'
        });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Usuarios SET activo = ~activo OUTPUT INSERTED.activo, INSERTED.nombre WHERE id_usuario = @id');

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        const { activo, nombre } = result.recordset[0];
        const statusStr = activo ? 'activado' : 'desactivado';

        return res.json({
            success: true,
            activo,
            message: `Usuario "${nombre}" ${statusStr} exitosamente.`
        });
    } catch (err) {
        console.error('Error al alternar estado de usuario:', err);
        return res.status(500).json({
            success: false,
            message: 'Error al modificar estado: ' + err.message
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
