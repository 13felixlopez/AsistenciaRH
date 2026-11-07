require('dotenv').config();
const { sql, dbConfig } = require('../config/db');
const bcrypt = require('bcryptjs');

async function seed() {
    try {
        console.log(`🌱 Conectando a SQL Server (${dbConfig.server}) para sembrar datos iniciales...`);
        const pool = await sql.connect(dbConfig);

        const adminPassHash = await bcrypt.hash('Admin123*', 10);
        const supervisorPassHash = await bcrypt.hash('Supervisor123*', 10);

        // 1. Roles base
        const roles = [
            { codigo: 'ADMIN', nombre: 'Administrador General', descripcion: 'Acceso irrestricto a todas las áreas, usuarios y reportes.' },
            { codigo: 'SUPERVISOR', nombre: 'Supervisor / Registrador de Área', descripcion: 'Acceso para registrar y ver reportes solo de sus áreas asignadas.' },
            { codigo: 'CONSULTOR', nombre: 'Consultor / Auditor', descripcion: 'Acceso de solo lectura a sus áreas asignadas.' }
        ];

        for (const rol of roles) {
            await pool.request()
                .input('cod', sql.VarChar, rol.codigo)
                .input('nom', sql.NVarChar, rol.nombre)
                .input('desc', sql.NVarChar, rol.descripcion)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM Roles WHERE codigo = @cod)
                        INSERT INTO Roles (codigo, nombre, descripcion) VALUES (@cod, @nom, @desc);
                `);
        }

        // 2. Administrador inicial
        const adminRolResult = await pool.request().query("SELECT id_rol FROM Roles WHERE codigo = 'ADMIN'");
        const adminRolId = adminRolResult.recordset[0].id_rol;

        const checkAdmin = await pool.request()
            .input('email', sql.VarChar, 'admin@asistencia.com')
            .query("SELECT id_usuario FROM Usuarios WHERE email = @email");

        if (checkAdmin.recordset.length > 0) {
            await pool.request()
                .input('id', sql.Int, checkAdmin.recordset[0].id_usuario)
                .input('hash', sql.VarChar, adminPassHash)
                .query("UPDATE Usuarios SET password_hash = @hash, usuario = 'admin', activo = 1 WHERE id_usuario = @id");
            console.log('✅ Usuario Administrador actualizado con contraseña activa (Admin123*)');
        } else {
            await pool.request()
                .input('id_rol', sql.Int, adminRolId)
                .input('nombre', sql.NVarChar, 'Administrador del Sistema')
                .input('usuario', sql.VarChar, 'admin')
                .input('email', sql.VarChar, 'admin@asistencia.com')
                .input('hash', sql.VarChar, adminPassHash)
                .input('cargo', sql.NVarChar, 'Director de Recursos Humanos')
                .query("INSERT INTO Usuarios (id_rol, nombre, usuario, email, password_hash, cargo, activo) VALUES (@id_rol, @nombre, @usuario, @email, @hash, @cargo, 1)");
            console.log('✅ Usuario Administrador creado: admin@asistencia.com / admin (Admin123*)');
        }

        // 3. Supervisor de demostración
        const supRolResult = await pool.request().query("SELECT id_rol FROM Roles WHERE codigo = 'SUPERVISOR'");
        const supRolId = supRolResult.recordset[0].id_rol;

        let supUserId;
        const checkSup = await pool.request()
            .input('email', sql.VarChar, 'supervisor.planta@asistencia.com')
            .query("SELECT id_usuario FROM Usuarios WHERE email = @email");

        if (checkSup.recordset.length > 0) {
            supUserId = checkSup.recordset[0].id_usuario;
            await pool.request()
                .input('id', sql.Int, supUserId)
                .input('hash', sql.VarChar, supervisorPassHash)
                .query("UPDATE Usuarios SET password_hash = @hash, usuario = 'supervisor', activo = 1 WHERE id_usuario = @id");
        } else {
            const insertSup = await pool.request()
                .input('id_rol', sql.Int, supRolId)
                .input('nombre', sql.NVarChar, 'Carlos Méndez (Supervisor)')
                .input('usuario', sql.VarChar, 'supervisor')
                .input('email', sql.VarChar, 'supervisor.planta@asistencia.com')
                .input('hash', sql.VarChar, supervisorPassHash)
                .input('cargo', sql.NVarChar, 'Supervisor de Producción')
                .query("INSERT INTO Usuarios (id_rol, nombre, usuario, email, password_hash, cargo, activo) OUTPUT INSERTED.id_usuario VALUES (@id_rol, @nombre, @usuario, @email, @hash, @cargo, 1)");
            supUserId = insertSup.recordset[0].id_usuario;
            console.log('✅ Usuario Supervisor creado: supervisor.planta@asistencia.com / supervisor (Supervisor123*)');
        }

        // 4. Áreas y Puestos de prueba si no existen
        const areasDemo = [
            { codigo: 'PROD', nombre: 'Producción y Planta', descripcion: 'Manufactura y ensamble' },
            { codigo: 'LOG', nombre: 'Logística y Almacén', descripcion: 'Recepción, inventario y despachos' },
            { codigo: 'ADM', nombre: 'Administración y Finanzas', descripcion: 'Contabilidad y recursos humanos' },
            { codigo: 'CAL', nombre: 'Control de Calidad', descripcion: 'Inspección de procesos y auditoría' }
        ];

        for (const a of areasDemo) {
            await pool.request()
                .input('cod', sql.VarChar, a.codigo)
                .input('nom', sql.NVarChar, a.nombre)
                .input('desc', sql.NVarChar, a.descripcion)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM Areas WHERE codigo = @cod)
                        INSERT INTO Areas (codigo, nombre, descripcion, activa) VALUES (@cod, @nom, @desc, 1);
                `);
        }

        // Asignar área de Producción al supervisor
        const prodAreaResult = await pool.request().query("SELECT id_area FROM Areas WHERE codigo = 'PROD'");
        if (prodAreaResult.recordset.length > 0 && supUserId) {
            const prodAreaId = prodAreaResult.recordset[0].id_area;
            await pool.request()
                .input('userId', sql.Int, supUserId)
                .input('areaId', sql.Int, prodAreaId)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM Usuario_Areas WHERE id_usuario = @userId AND id_area = @areaId)
                        INSERT INTO Usuario_Areas (id_usuario, id_area, permite_registro, permite_reportes)
                        VALUES (@userId, @areaId, 1, 1);
                `);
        }

        // Puestos de prueba
        const prodId = prodAreaResult.recordset[0]?.id_area;
        if (prodId) {
            const puestosProd = ['Operador de Línea 1', 'Operador de Ensamble', 'Técnico de Mantenimiento'];
            for (const pNom of puestosProd) {
                await pool.request()
                    .input('areaId', sql.Int, prodId)
                    .input('nom', sql.NVarChar, pNom)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @areaId AND nombre = @nom)
                            INSERT INTO Puestos (id_area, nombre, activo) VALUES (@areaId, @nom, 1);
                    `);
            }
        }

        console.log('🎉 Sembrado y verificación completados exitosamente.');
        await pool.close();
    } catch (err) {
        console.error('❌ Error en seed:', err.message);
    }
}

if (require.main === module) {
    seed();
}

module.exports = seed;
