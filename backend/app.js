require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { getPool } = require('./config/db');
const { isAuthenticated } = require('./middlewares/auth');

// Rutas API
const authRoutes = require('./routes/authRoutes');
const areaRoutes = require('./routes/areaRoutes');
const puestoRoutes = require('./routes/puestoRoutes');
const ubicacionRoutes = require('./routes/ubicacionRoutes');
const asistenciaRoutes = require('./routes/asistenciaRoutes');
const reporteRoutes = require('./routes/reporteRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const dashboardController = require('./controllers/dashboardController');

const app = express();
const PORT = process.env.PORT || 3031;

// Configuración de CORS
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Middlewares generales
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint de comprobación de salud del servidor
app.get('/api/health', (req, res) => {
    res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        service: 'AsistenciaRH API'
    });
});

// Rutas Públicas de Autenticación
app.use('/api/auth', authRoutes);

// Rutas Protegidas del Sistema
app.get('/api/dashboard', isAuthenticated, dashboardController.showDashboard);
app.use('/api/areas', areaRoutes);
app.use('/api/puestos', puestoRoutes);
app.use('/api/ubicaciones', ubicacionRoutes);
app.use('/api/asistencias', asistenciaRoutes);
app.use('/api/reportes', reporteRoutes);
app.use('/api/usuarios', usuarioRoutes);

// Manejo de rutas no encontradas (404)
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`
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

// Inicialización del Servidor y verificación de Base de Datos
const { autocompletarAsistenciasPasadas } = require('./services/asistenciaService');

async function startServer() {
    try {
        console.log('🔄 Conectando con Microsoft SQL Server...');
        await getPool();
        app.listen(PORT, () => {
            console.log('======================================================');
            console.log(`🚀 API AsistenciaRH corriendo en: http://localhost:${PORT}`);
            console.log(`📡 Modo de entorno: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🌐 CORS habilitado para: ${corsOrigin}`);
            console.log('======================================================');

            // Autocompletado de puestos nulos en fechas pasadas
            autocompletarAsistenciasPasadas().catch(e => console.error('Error autocompletar al inicio:', e.message));

            // Revisión periódica cada 30 minutos para cierre automático tras la medianoche
            setInterval(() => {
                autocompletarAsistenciasPasadas().catch(e => console.error('Error autocompletar periódico:', e.message));
            }, 1000 * 60 * 30);
        });
    } catch (err) {
        console.error('❌ No se pudo iniciar el servidor debido a fallos con SQL Server:', err.message);
        process.exit(1);
    }
}

startServer();
