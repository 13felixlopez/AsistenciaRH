// Configuración de conexión al Backend (Netlify Serverless + Turso)
// Al estar desplegado en Netlify, las peticiones a '/api' son atendidas directamente
// por la Netlify Function mediante la regla de redirección de netlify.toml.
const API_BASE_URL = localStorage.getItem('API_BASE_URL') || '/api';
