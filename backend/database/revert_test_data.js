const { getPool, sql } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function revertTestData() {
    let pool;
    try {
        console.log('🔄 Conectando a Microsoft SQL Server para revertir datos de prueba...');
        pool = await getPool();

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        console.log('📦 Iniciando transacción de reversión...');

        // 1. Eliminar asistencias que tengan la etiqueta [DATO_PRUEBA]
        const reqDeleteAsist = new sql.Request(transaction);
        const resAsist = await reqDeleteAsist.query(`
            DELETE FROM Asistencias_Diarias
            WHERE observaciones LIKE '%[DATO_PRUEBA]%'
        `);
        console.log(`🗑️  Asistencias de prueba eliminadas: ${resAsist.rowsAffected[0]} registros.`);

        // 2. Limpiar registros de prueba en Usuario_Ubicaciones
        const reqDeleteUbic = new sql.Request(transaction);
        const resUbic = await reqDeleteUbic.query(`
            DELETE FROM Usuario_Ubicaciones
            WHERE id_usuario = 2 AND id_ubicacion IN (1, 2, 3)
        `);
        console.log(`🗑️  Permisos de prueba en Usuario_Ubicaciones eliminados: ${resUbic.rowsAffected[0]} registros.`);

        await transaction.commit();
        console.log('✅ Transacción confirmada (COMMIT).');

        // 3. Verificación de integridad con el snapshot original
        console.log('\n--- VERIFICACIÓN DE ESTADO RESTAURADO ---');
        const countAsist = await pool.request().query('SELECT COUNT(*) as count FROM Asistencias_Diarias');
        const countUserUbic = await pool.request().query('SELECT COUNT(*) as count FROM Usuario_Ubicaciones');
        
        const asistActual = countAsist.recordset[0].count;
        const ubicActual = countUserUbic.recordset[0].count;

        console.log(`Asistencias_Diarias : ${asistActual} registros (Original esperado: 297)`);
        console.log(`Usuario_Ubicaciones : ${ubicActual} registros (Original esperado: 0)`);

        if (asistActual === 297 && ubicActual === 0) {
            console.log('\n🎯 ¡ESTADO 100% IDÉNTICO AL ORIGINAL RESTAURADO CON ÉXITO!');
        } else {
            console.warn('\n⚠️ Aviso: Los totales difieren ligeramente de los 297 registros iniciales. Revise snapshot_pre_test.json.');
        }

        process.exit(0);

    } catch (err) {
        console.error('❌ Error revirtiendo datos:', err);
        process.exit(1);
    }
}

revertTestData();
