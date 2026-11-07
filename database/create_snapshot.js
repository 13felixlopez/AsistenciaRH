const fs = require('fs');
const path = require('path');
const { getPool } = require('../config/db');

async function createSnapshot() {
    try {
        console.log('🔄 Conectando para crear snapshot del estado original de la base de datos...');
        const pool = await getPool();

        const tablesToBackup = [
            'Asistencias_Diarias',
            'Usuario_Ubicaciones',
            'Usuario_Areas',
            'Ubicaciones'
        ];

        const snapshot = {
            created_at: new Date().toISOString(),
            tables: {}
        };

        for (const tableName of tablesToBackup) {
            const res = await pool.request().query(`SELECT * FROM ${tableName}`);
            snapshot.tables[tableName] = res.recordset;
            console.log(`  📸 Respaldada tabla ${tableName}: ${res.recordset.length} registros`);
        }

        const snapshotPath = path.join(__dirname, 'snapshot_pre_test.json');
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
        console.log(`\n✅ Snapshot guardado exitosamente en: ${snapshotPath}`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error creando snapshot:', err);
        process.exit(1);
    }
}

createSnapshot();
