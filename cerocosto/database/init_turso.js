/**
 * Script de inicialización y migración a Turso (libSQL / SQLite)
 * Uso: node database/init_turso.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    console.error('❌ Error: Debes configurar TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en el archivo .env');
    process.exit(1);
}

async function initTurso() {
    console.log('🚀 Conectando a Turso DB en:', url);

    let client;
    try {
        const { createClient } = require('@libsql/client');
        client = createClient({ url, authToken });
    } catch (e) {
        console.log('⚠️ @libsql/client no encontrado localmente. Usando cliente HTTP nativo...');
    }

    const schemaPath = path.join(__dirname, 'schema_turso.sql');
    const seedPath = path.join(__dirname, 'seed_turso.sql');

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const seedSql = fs.readFileSync(seedPath, 'utf8');

    // Función para ejecutar SQL por lotes
    async function executeBatch(sqlContent, label) {
        console.log(`⏳ Aplicando ${label}...`);
        const cleaned = sqlContent
            .replace(/--.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        const statements = cleaned
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        if (client) {
            for (const stmt of statements) {
                try {
                    await client.execute(stmt);
                } catch (err) {
                    console.warn(`Aviso en sentencia [${stmt.substring(0, 40)}...]:`, err.message);
                }
            }
        } else {
            // Fallback usando fetch HTTP pipeline de Turso
            const pipelineUrl = url.replace('libsql://', 'https://') + '/v2/pipeline';
            const requests = statements.map(sql => ({ type: 'execute', stmt: { sql } }));
            requests.push({ type: 'close' });

            const res = await fetch(pipelineUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ requests })
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`HTTP Error ${res.status}: ${txt}`);
            }
        }
        console.log(`✅ ${label} aplicado con éxito (${statements.length} sentencias).`);
    }

    try {
        await executeBatch(schemaSql, 'Esquema de Tablas (schema_turso.sql)');
        await executeBatch(seedSql, 'Datos Iniciales (seed_turso.sql)');
        console.log('\n🎉 ¡Base de datos Turso inicializada y lista para producción!');
    } catch (err) {
        console.error('❌ Error durante la inicialización:', err);
        process.exit(1);
    }
}

initTurso();
