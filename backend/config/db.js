const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const url = process.env.TURSO_DATABASE_URL || 'libsql://asistenciarh-13felixlopez.aws-us-east-1.turso.io';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

const client = createClient({
    url,
    authToken
});

let migrationChecked = false;

/**
 * Verifica y aplica automáticamente columnas y migraciones pendientes en Turso DB
 */
async function verifyAndMigrateTurso() {
    if (migrationChecked) return;
    try {
        // 1. Verificar y migrar Puestos
        const puestoTableCheck = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Puestos'");
        if (puestoTableCheck.rows && puestoTableCheck.rows.length > 0) {
            const tableInfo = await client.execute("PRAGMA table_info(Puestos)");
            if (tableInfo.rows && tableInfo.rows.length > 0) {
                const hasCol = tableInfo.rows.some(r => r.name === 'cantidad_contratada');
                if (!hasCol) {
                    console.log('🔄 Agregando columna cantidad_contratada a Puestos en Turso DB...');
                    await client.execute("ALTER TABLE Puestos ADD COLUMN cantidad_contratada INTEGER NOT NULL DEFAULT 0");
                    console.log('✅ Columna cantidad_contratada agregada exitosamente en Turso DB.');
                }
            }
        }

        // 2. Verificar y migrar Asistencias_Diarias (id_usuario_modificacion y fecha_modificacion)
        const asisTableCheck = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Asistencias_Diarias'");
        if (asisTableCheck.rows && asisTableCheck.rows.length > 0) {
            const asisInfo = await client.execute("PRAGMA table_info(Asistencias_Diarias)");
            if (asisInfo.rows && asisInfo.rows.length > 0) {
                const hasUserMod = asisInfo.rows.some(r => r.name === 'id_usuario_modificacion');
                if (!hasUserMod) {
                    console.log('🔄 Agregando columna id_usuario_modificacion a Asistencias_Diarias en Turso DB...');
                    await client.execute("ALTER TABLE Asistencias_Diarias ADD COLUMN id_usuario_modificacion INTEGER");
                    console.log('✅ Columna id_usuario_modificacion agregada exitosamente en Turso DB.');
                }

                const hasFechaMod = asisInfo.rows.some(r => r.name === 'fecha_modificacion');
                if (!hasFechaMod) {
                    console.log('🔄 Agregando columna fecha_modificacion a Asistencias_Diarias en Turso DB...');
                    await client.execute("ALTER TABLE Asistencias_Diarias ADD COLUMN fecha_modificacion TEXT");
                    console.log('✅ Columna fecha_modificacion agregada exitosamente en Turso DB.');
                }

                // 3. Limpiar índices obsoletos que pudieran impedir el Turno 2
                await client.execute("DROP INDEX IF EXISTS UQ_Fecha_Puesto");
                await client.execute("DROP INDEX IF EXISTS UQ_Fecha_Puesto_Turno");

                // Estandarizar valores de turnos existentes
                await client.execute("UPDATE Asistencias_Diarias SET turno = 'TURNO_1' WHERE turno = 'TURNO 1' OR turno = 'Turno 1'");
                await client.execute("UPDATE Asistencias_Diarias SET turno = 'TURNO_2' WHERE turno = 'TURNO 2' OR turno = 'Turno 2'");
                await client.execute("UPDATE Asistencias_Diarias SET turno = 'UNICO' WHERE turno IS NULL OR turno = '' OR turno = 'TURNO UNICO'");

                // Asegurar índice único por (fecha, id_puesto, turno, id_ubicacion)
                await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS UQ_Asistencia_Slot ON Asistencias_Diarias (fecha, id_puesto, turno, COALESCE(id_ubicacion, 0))");
            }
        }

        migrationChecked = true;
    } catch (err) {
        console.warn('Nota migración automática Turso:', err.message);
    }
}

/**
 * Adaptador de compatibilidad para ejecutar queries en Turso (SQLite/libSQL)
 * Retorna un objeto con formato { recordset, rowsAffected, lastInsertRowid }
 * compatible con la arquitectura del sistema.
 */
async function query(sql, args = []) {
    if (!migrationChecked && !sql.includes('sqlite_master') && !sql.includes('table_info')) {
        await verifyAndMigrateTurso();
    }
    const res = await client.execute({ sql, args });
    return {
        recordset: res.rows || [],
        rowsAffected: res.rowsAffected || 0,
        lastInsertRowid: res.lastInsertRowid
    };
}

/**
 * Inicializa automáticamente las tablas y datos semilla en Turso
 * si la base de datos se encuentra vacía.
 */
let isInitializing = false;
async function initDatabase(force = false) {
    if (isInitializing) return { initialized: false, message: 'Inicialización en curso...' };
    isInitializing = true;

    try {
        if (!force) {
            try {
                const check = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Usuarios'");
                if (check.rows && check.rows.length > 0) {
                    return { initialized: false, message: 'Base de datos ya inicializada con tablas activas.' };
                }
            } catch (e) {
                // Tablas no existen, procede a crearlas
            }
        }

        const schemaPath = path.join(__dirname, '../../database/schema_turso.sql');
        const seedPath = path.join(__dirname, '../../database/seed_turso.sql');

        if (!fs.existsSync(schemaPath) || !fs.existsSync(seedPath)) {
            return { initialized: false, message: 'Archivos SQL de esquema no encontrados.' };
        }

        const cleanSql = (txt) => txt.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const schemaStmts = cleanSql(fs.readFileSync(schemaPath, 'utf8')).split(';').map(s => s.trim()).filter(s => s.length > 0);
        const seedStmts = cleanSql(fs.readFileSync(seedPath, 'utf8')).split(';').map(s => s.trim()).filter(s => s.length > 0);

        for (const stmt of schemaStmts) {
            try {
                await client.execute(stmt);
            } catch (err) {
                console.warn('Aviso esquema Turso:', err.message);
            }
        }

        for (const stmt of seedStmts) {
            try {
                await client.execute(stmt);
            } catch (err) {
                console.warn('Aviso semilla Turso:', err.message);
            }
        }

        return { initialized: true, message: 'Tablas y datos iniciales creados exitosamente en Turso DB.' };
    } catch (err) {
        console.error('Error inicializando base de datos Turso:', err);
        throw err;
    } finally {
        isInitializing = false;
    }
}

module.exports = {
    client,
    query,
    initDatabase,
    verifyAndMigrateTurso
};
