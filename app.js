require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const morgan = require('morgan');
const cors = require('cors');
const expressLayouts = require('express-ejs-layouts');

const { getPool } = require('./config/db');
const { isAuthenticated } = require('./middlewares/auth');

// Rutas
const authRoutes = require('./routes/authRoutes');
const areaRoutes = require('./routes/areaRoutes');
const puestoRoutes = require('./routes/puestoRoutes');
const ubicacionRoutes = require('./routes/ubicacionRoutes');
const asistenciaRoutes = require('./routes/asistenciaRoutes');
const reporteRoutes = require('./routes/reporteRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const apiRoutes = require('./routes/apiRoutes');
const dashboardController = require('./controllers/dashboardController');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Motor de Vistas EJS con Layouts
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// Middlewares generales
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos y habilitar ámbito raíz para Service Worker PWA
app.use((req, res, next) => {
    if (req.path === '/sw.js') {
        res.setHeader('Service-Worker-Allowed', '/');
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Manejo de Sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8 horas de sesión
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Mensajes Flash
app.use(flash());

// Variables globales para vistas EJS
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');
    res.locals.currentPath = req.path;
    next();
});

// Rutas Públicas de Autenticación
app.use('/auth', authRoutes);

// Rutas Protegidas del Sistema
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        if (req.session.user.rol_codigo === 'ADMIN') {
            return res.redirect('/dashboard');
        }
        return res.redirect('/asistencias/registro');
    }
    return res.redirect('/auth/login');
});

app.get('/dashboard', isAuthenticated, dashboardController.showDashboard);
app.use('/areas', areaRoutes);
app.use('/puestos', puestoRoutes);
app.use('/ubicaciones', ubicacionRoutes);
app.use('/asistencias', asistenciaRoutes);
app.use('/reportes', reporteRoutes);
app.use('/usuarios', usuarioRoutes);
app.use('/api', apiRoutes);


// Manejo de errores 404
app.use((req, res) => {
    res.status(404).render('errors/404', {
        title: 'Página No Encontrada (404) | Registro de Asistencia',
        layout: req.session.user ? 'layouts/main' : 'layouts/auth'
    });
});

// Manejo global de errores 500
app.use((err, req, res, next) => {
    console.error('💥 Error no controlado:', err);
    res.status(500).render('errors/500', {
        title: 'Error del Servidor (500) | Registro de Asistencia',
        error: process.env.NODE_ENV === 'development' ? err : {},
        layout: req.session.user ? 'layouts/main' : 'layouts/auth'
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
            console.log(`🚀 Servidor AsistenciaRH corriendo en: http://localhost:${PORT}`);
            console.log(`📡 Modo de entorno: ${process.env.NODE_ENV || 'development'}`);
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
