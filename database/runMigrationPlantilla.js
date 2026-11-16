const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../config/db');

async function runMigrationPlantilla() {
    try {
        const pool = await getPool();
        const sqlFilePath = path.join(__dirname, 'migration_plantilla_contratada.sql');
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

        const batches = sqlContent
            .split(/^GO\s*$/gmi)
            .map(b => b.trim())
            .filter(b => b.length > 0 && !b.startsWith('USE '));

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            await pool.request().batch(batch);
        }

        console.log('✅ Migración de plantilla contratada verificada/aplicada en SQL Server.');
    } catch (err) {
        console.warn('⚠️ Nota sobre migración de plantilla:', err.message);
    }
}

if (require.main === module) {
    runMigrationPlantilla().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runMigrationPlantilla };
