const serverless = require('serverless-http');
const app = require('../../backend/app');

// Exportar handler para Netlify Functions
module.exports.handler = serverless(app);
