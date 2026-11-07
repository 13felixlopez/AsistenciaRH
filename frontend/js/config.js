// Configuración de conexión al Backend
// Nota para Netlify: Reemplaza esta URL por la IP pública o dominio de tu servidor propio con HTTPS
const API_BASE_URL = localStorage.getItem('API_BASE_URL') || (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3031/api'
        : 'http://localhost:3031/api' // <-- Reemplaza por la URL de tu servidor en producción
);
