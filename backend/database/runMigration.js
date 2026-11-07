const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../config/db');

async function runMigration() {
    try {
        console.log('🔄 Conectando a SQL Server para ejecutar migración...');
        const pool = await getPool();

        const sqlFilePath = path.join(__dirname, 'migration_ubicaciones_y_permisos.sql');
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

        // Separar por bloques GO
        const batches = sqlContent
            .split(/^GO\s*$/gmi)
            .map(b => b.trim())
            .filter(b => b.length > 0 && !b.startsWith('USE '));

        console.log(`📦 Procesando ${batches.length} lotes de migración...`);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            try {
                await pool.request().batch(batch);
                console.log(`  ✓ Lote ${i + 1}/${batches.length} aplicado con éxito.`);
            } catch (batchErr) {
                console.error(`  ❌ Error en lote ${i + 1}:`, batchErr.message);
                throw batchErr;
            }
        }

        // Consultar resultados
        const ubicacionesRes = await pool.request().query(`
            SELECT u.id_ubicacion, u.codigo, u.nombre, a.nombre AS area_nombre
            FROM Ubicaciones u
            INNER JOIN Areas a ON u.id_area = a.id_area
            ORDER BY a.nombre, u.nombre
        `);

        console.log('✅ Migración aplicada exitosamente. Ubicaciones registradas:');
        console.table(ubicacionesRes.recordset);

        process.exit(0);
    } catch (err) {
        console.error('💥 Error fatal al aplicar migración:', err);
        process.exit(1);
    }
}

runMigration();
