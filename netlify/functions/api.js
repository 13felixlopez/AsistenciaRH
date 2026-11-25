const serverless = require('serverless-http');
let app;
try {
    app = require('../../backend/app');
} catch (e) {
    app = require('../../cerocosto/backend/app');
}

// Handler serverless para la función Netlify Functions cuando se compila desde la raíz
module.exports.handler = serverless(app);
