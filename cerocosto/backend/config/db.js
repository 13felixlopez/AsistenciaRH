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

/**
 * Adaptador de compatibilidad para ejecutar queries en Turso (SQLite/libSQL)
 * Retorna un objeto con formato { recordset, rowsAffected, lastInsertRowid }
 * compatible con la arquitectura del sistema.
 */
async function query(sql, args = []) {
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
    initDatabase
};
