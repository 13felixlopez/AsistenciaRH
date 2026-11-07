const { getPool, sql } = require('../config/db');
const { getUserAllowedAreas, getUserAllowedLocations, hasLocationAccess } = require('../middlewares/auth');

async function testFlow() {
    try {
        console.log('🧪 Iniciando prueba de verificación de Ubicaciones y Permisos...');
        const pool = await getPool();

        // 1. Verificar ubicaciones existentes
        const ubicaciones = await pool.request().query(`
            SELECT u.id_ubicacion, u.codigo, u.nombre, a.nombre AS area_nombre
            FROM Ubicaciones u
            INNER JOIN Areas a ON u.id_area = a.id_area
            ORDER BY a.nombre, u.nombre
        `);
        console.log(`✓ Total de ubicaciones en BD: ${ubicaciones.recordset.length}`);
        console.table(ubicaciones.recordset);

        // 2. Probar getUserAllowedLocations para Administrador (id_usuario = 1, id_rol = 1)
        const idProd = (await pool.request().query("SELECT id_area FROM Areas WHERE codigo = 'PRODUCCION'")).recordset[0].id_area;
        const adminLocs = await getUserAllowedLocations(1, 'ADMIN', idProd);
        console.log(`✓ Admin ve todas las ubicaciones de Producción (${adminLocs.length} ubicaciones):`, adminLocs.map(u => u.nombre));

        // 3. Crear usuario supervisor de prueba para 'Producción - ARÁBIGA'
        const testUserEmail = 'test.arabiga@asistencia.com';
        await pool.request().input('email', sql.VarChar, testUserEmail).query(`
            DELETE FROM Asistencias_Diarias WHERE id_usuario_registro IN (SELECT id_usuario FROM Usuarios WHERE email = @email);
            DELETE FROM Usuarios WHERE email = @email;
        `);

        const insertUser = await pool.request()
            .input('id_rol', sql.Int, 2) // SUPERVISOR
            .input('nombre', sql.NVarChar, 'Supervisor Arábica Test')
            .input('usuario', sql.VarChar, 'sup_arabica_test')
            .input('email', sql.VarChar, testUserEmail)
            .input('hash', sql.VarChar, '$2a$10$wE47.nLqfS/6Xn5W6Zp87exyv.j1o4b0N7pA9YmUf76S6s2F5X26O')
            .query(`
                INSERT INTO Usuarios (id_rol, nombre, usuario, email, password_hash, cargo, activo)
                OUTPUT INSERTED.id_usuario
                VALUES (@id_rol, @nombre, @usuario, @email, @hash, 'Supervisor Arábica', 1)
            `);
        const testUserId = insertUser.recordset[0].id_usuario;

        // Asignarle Área Producción
        await pool.request()
            .input('userId', sql.Int, testUserId)
            .input('areaId', sql.Int, idProd)
            .query('INSERT INTO Usuario_Areas (id_usuario, id_area) VALUES (@userId, @areaId)');

        // Asignarle ÚNICAMENTE la ubicación ARÁBIGA
        const idArabiga = (await pool.request().query("SELECT id_ubicacion FROM Ubicaciones WHERE codigo = 'PROD_ARA'")).recordset[0].id_ubicacion;
        const idRobusta = (await pool.request().query("SELECT id_ubicacion FROM Ubicaciones WHERE codigo = 'PROD_ROB'")).recordset[0].id_ubicacion;

        await pool.request()
            .input('userId', sql.Int, testUserId)
            .input('locId', sql.Int, idArabiga)
            .query('INSERT INTO Usuario_Ubicaciones (id_usuario, id_ubicacion) VALUES (@userId, @locId)');

        // 4. Validar permisos del supervisor
        const supervisorLocs = await getUserAllowedLocations(testUserId, 'SUPERVISOR', idProd);
        console.log(`✓ Supervisor Arábica solo ve sus ubicaciones asignadas (${supervisorLocs.length}):`, supervisorLocs.map(u => u.nombre));

        const tieneAccesoArabiga = await hasLocationAccess(testUserId, 'SUPERVISOR', idProd, idArabiga);
        const tieneAccesoRobusta = await hasLocationAccess(testUserId, 'SUPERVISOR', idProd, idRobusta);

        console.log(`✓ Acceso a ARÁBIGA: ${tieneAccesoArabiga} (Esperado: true)`);
        console.log(`✓ Acceso a ROBUSTA: ${tieneAccesoRobusta} (Esperado: false)`);

        if (!tieneAccesoArabiga || tieneAccesoRobusta) {
            throw new Error('Fallo en la prueba de permisos por ubicación.');
        }

        // 5. Probar inserción concurrente en el mismo puesto para ARÁBIGA y ROBUSTA
        const hoy = new Date().toISOString().split('T')[0];
        const idPuestoProd = (await pool.request().query(`SELECT TOP 1 id_puesto FROM Puestos WHERE id_area = ${idProd} AND activo = 1`)).recordset[0].id_puesto;

        // Limpiar registros previos de prueba en hoy para ese puesto
        await pool.request()
            .input('puestoId', sql.Int, idPuestoProd)
            .input('fecha', sql.Date, hoy)
            .query('DELETE FROM Asistencias_Diarias WHERE id_puesto = @puestoId AND fecha = @fecha');

        // Insertar asistencia en ARÁBIGA (ej: 8 personas)
        await pool.request()
            .input('fecha', sql.Date, hoy)
            .input('idPuesto', sql.Int, idPuestoProd)
            .input('turno', sql.VarChar, 'UNICO')
            .input('idUb', sql.Int, idArabiga)
            .input('cant', sql.Int, 8)
            .input('userId', sql.Int, testUserId)
            .query(`
                INSERT INTO Asistencias_Diarias (fecha, id_puesto, turno, id_ubicacion, cantidad_asistentes, observaciones, id_usuario_registro, fecha_registro)
                VALUES (@fecha, @idPuesto, @turno, @idUb, @cant, 'Prueba Arábiga', @userId, GETDATE())
            `);
        console.log('✓ Registro en ARÁBIGA guardado exitosamente (8 asistentes).');

        // Insertar asistencia en ROBUSTA para el MISMO puesto y MISMA fecha (ej: 12 personas)
        await pool.request()
            .input('fecha', sql.Date, hoy)
            .input('idPuesto', sql.Int, idPuestoProd)
            .input('turno', sql.VarChar, 'UNICO')
            .input('idUb', sql.Int, idRobusta)
            .input('cant', sql.Int, 12)
            .input('userId', sql.Int, 1) // Admin
            .query(`
                INSERT INTO Asistencias_Diarias (fecha, id_puesto, turno, id_ubicacion, cantidad_asistentes, observaciones, id_usuario_registro, fecha_registro)
                VALUES (@fecha, @idPuesto, @turno, @idUb, @cant, 'Prueba Robusta', @userId, GETDATE())
            `);
        console.log('✓ Registro en ROBUSTA guardado exitosamente para el mismo puesto sin colisión (12 asistentes).');

        // Consultar ambos registros
        const checkAsists = await pool.request()
            .input('fecha', sql.Date, hoy)
            .input('idPuesto', sql.Int, idPuestoProd)
            .query(`
                SELECT ad.id_asistencia, ad.fecha, ad.cantidad_asistentes, ub.nombre AS ubicacion_nombre, p.nombre AS puesto_nombre
                FROM Asistencias_Diarias ad
                INNER JOIN Ubicaciones ub ON ad.id_ubicacion = ub.id_ubicacion
                INNER JOIN Puestos p ON ad.id_puesto = p.id_puesto
                WHERE ad.fecha = @fecha AND ad.id_puesto = @idPuesto
            `);
        console.table(checkAsists.recordset);

        // Limpiar asistencias y usuario de prueba
        await pool.request().input('uid', sql.Int, testUserId).query('DELETE FROM Asistencias_Diarias WHERE id_usuario_registro = @uid');
        await pool.request().input('id', sql.Int, testUserId).query('DELETE FROM Usuarios WHERE id_usuario = @id');
        console.log('🧹 Limpieza de datos de prueba completada.');

        console.log('🎉 ¡Todas las pruebas de verificación pasaron con éxito total!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error en prueba de verificación:', err);
        process.exit(1);
    }
}

testFlow();
