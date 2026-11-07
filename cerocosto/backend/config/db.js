const { createClient } = require('@libsql/client');
const path = require('path');
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
    // Normalizar argumentos si vienen como objeto de parámetros con nombre :nombre o @nombre
    const res = await client.execute({ sql, args });
    return {
        recordset: res.rows || [],
        rowsAffected: res.rowsAffected || 0,
        lastInsertRowid: res.lastInsertRowid
    };
}

module.exports = {
    client,
    query
};
