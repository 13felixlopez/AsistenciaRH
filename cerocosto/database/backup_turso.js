/**
 * Script de Respaldo Automatizado para Turso DB (libSQL / SQLite)
 * Uso manual o programado (cron/scheduler):
 *   node database/backup_turso.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    console.error('❌ Error: Variables TURSO_DATABASE_URL o TURSO_AUTH_TOKEN no configuradas en .env');
    process.exit(1);
}

async function runBackup() {
    console.log('======================================================');
    console.log('📦 INICIANDO RESPALDO DE BASE DE DATOS TURSO');
    console.log('📡 Base de Datos:', url);
    console.log('🕒 Fecha:', new Date().toLocaleString());
    console.log('======================================================');

    const client = createClient({ url, authToken });

    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    const fileName = `asistenciarh_backup_${timestamp}.sql`;
    const filePath = path.join(backupDir, fileName);

    const tables = [
        'Roles',
        'Areas',
        'Ubicaciones',
        'Puestos',
        'Usuarios',
        'Usuario_Areas',
        'Usuario_Ubicaciones',
        'Asistencias'
    ];

    let sqlDump = `-- =====================================================================\n`;
    sqlDump += `-- RESPALDO AUTOMATIZADO TURSO LIBSQL: AsistenciaRH\n`;
    sqlDump += `-- Archivo: ${fileName}\n`;
    sqlDump += `-- Fecha: ${new Date().toISOString()}\n`;
    sqlDump += `-- =====================================================================\n\n`;
    sqlDump += `PRAGMA foreign_keys = OFF;\n`;
    sqlDump += `BEGIN TRANSACTION;\n\n`;

    let totalRecords = 0;

    for (const tableName of tables) {
        try {
            const res = await client.execute(`SELECT * FROM ${tableName}`);
            const rows = res.rows;
            totalRecords += rows.length;

            console.log(`⏳ Respaldando ${tableName.padEnd(20)}: ${rows.length} registros`);

            sqlDump += `-- Tabla: ${tableName} (${rows.length} registros)\n`;
            sqlDump += `DELETE FROM ${tableName};\n`;

            if (rows.length > 0) {
                const columns = res.columns;
                for (const row of rows) {
                    const values = columns.map(col => {
                        const val = row[col];
                        if (val === null || val === undefined) return 'NULL';
                        if (typeof val === 'number') return val;
                        if (typeof val === 'boolean') return val ? 1 : 0;
                        const escaped = String(val).replace(/'/g, "''");
                        return `'${escaped}'`;
                    });
                    sqlDump += `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
                }
            }
            sqlDump += `\n`;
        } catch (err) {
            console.warn(`⚠️ Error en tabla ${tableName}:`, err.message);
            sqlDump += `-- Error en tabla ${tableName}: ${err.message}\n\n`;
        }
    }

    sqlDump += `COMMIT;\n`;
    sqlDump += `PRAGMA foreign_keys = ON;\n\n`;
    sqlDump += `-- Fin del Respaldo. Total de registros: ${totalRecords}\n`;

    fs.writeFileSync(filePath, sqlDump, 'utf8');

    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);

    console.log('======================================================');
    console.log('✅ ¡RESPALDO COMPLETADO CON ÉXITO!');
    console.log(`📁 Archivo generado: ${fileName}`);
    console.log(`📊 Tamaño: ${sizeKB} KB (${totalRecords} registros en total)`);
    console.log(`📂 Ruta: ${filePath}`);
    console.log('======================================================');
}

runBackup().catch(err => {
    console.error('💥 Error crítico durante el respaldo:', err.message);
    process.exit(1);
});
