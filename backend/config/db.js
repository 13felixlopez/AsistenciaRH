const sql = require('mssql');
require('dotenv').config();

const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined;
// Si se indica puerto TCP, nos conectamos directo por IP:PUERTO sin depender de SQL Server Browser (UDP 1434)
const instanceName = (!port && process.env.DB_INSTANCE) ? process.env.DB_INSTANCE : undefined;

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    connectionTimeout: 15000,
    requestTimeout: 30000,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        useUTC: false
    },
    pool: {
        max: 20,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

if (port) {
    dbConfig.port = port;
}

if (instanceName) {
    dbConfig.options.instanceName = instanceName;
}

let poolPromise = null;

async function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(dbConfig)
            .connect()
            .then(pool => {
                console.log(`✅ Conexión establecida con SQL Server (${dbConfig.server}:${dbConfig.port || 'default'} -> ${dbConfig.database})`);
                return pool;
            })
            .catch(err => {
                console.error('❌ Error fatal al conectar con SQL Server:', err.message);
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

module.exports = {
    sql,
    getPool,
    dbConfig
};
