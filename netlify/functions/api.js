const serverless = require('serverless-http');
const app = require('../../cerocosto/backend/app');

// Handler serverless para la función Netlify Functions cuando se compila desde la raíz
module.exports.handler = serverless(app);
