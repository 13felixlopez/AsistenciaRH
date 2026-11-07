const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

const { isAuthenticated } = require('./middlewares/auth');

// Controladores y Rutas
const { initDatabase } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const areaRoutes = require('./routes/areaRoutes');
const puestoRoutes = require('./routes/puestoRoutes');
const ubicacionRoutes = require('./routes/ubicacionRoutes');
const asistenciaRoutes = require('./routes/asistenciaRoutes');
const reporteRoutes = require('./routes/reporteRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const dashboardController = require('./controllers/dashboardController');

const app = express();

// Configuración de CORS
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Middlewares generales
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enrutador unificado para la API
const apiRouter = express.Router();

// Comprobación de salud
apiRouter.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        service: 'AsistenciaRH API (Netlify + Turso)'
    });
});

// Endpoint de inicialización / migración de base de datos en Turso
apiRouter.get('/init-db', async (req, res) => {
    try {
        const force = req.query.force === 'true';
        const result = await initDatabase(force);
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Error inicializando base de datos en Turso: ' + err.message
        });
    }
});

// Rutas Públicas de Autenticación
apiRouter.use('/auth', authRoutes);

// Rutas Protegidas del Sistema
apiRouter.get('/dashboard', isAuthenticated, dashboardController.showDashboard);
apiRouter.use('/areas', areaRoutes);
apiRouter.use('/puestos', puestoRoutes);
apiRouter.use('/ubicaciones', ubicacionRoutes);
apiRouter.use('/asistencias', asistenciaRoutes);
apiRouter.use('/reportes', reporteRoutes);
apiRouter.use('/usuarios', usuarioRoutes);

// Montar en todas las rutas para compatibilidad total con Netlify Functions y desarrollo local
app.use('/.netlify/functions/api', apiRouter);
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Manejador 404 siempre en formato JSON
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Ruta no encontrada en la API: ${req.method} ${req.originalUrl || req.url}`
    });
});

// Manejo global de errores (500)
app.use((err, req, res, next) => {
    console.error('💥 Error no controlado en API:', err);
    res.status(500).json({
        success: false,
        message: 'Error interno del servidor.',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Si se ejecuta directamente con Node (desarrollo local)
if (require.main === module) {
    const PORT = process.env.PORT || 3031;
    app.listen(PORT, () => {
        console.log('======================================================');
        console.log(`🚀 API AsistenciaRH corriendo en: http://localhost:${PORT}`);
        console.log(`📡 Base de Datos: Turso libSQL`);
        console.log('======================================================');
    });
}

module.exports = app;
