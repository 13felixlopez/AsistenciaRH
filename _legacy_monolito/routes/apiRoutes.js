const express = require('express');
const router = express.Router();
const puestoController = require('../controllers/puestoController');
const areaController = require('../controllers/areaController');
const ubicacionController = require('../controllers/ubicacionController');
const asistenciaController = require('../controllers/asistenciaController');
const { isAuthenticated } = require('../middlewares/auth');

router.use(isAuthenticated);

router.get('/puestos/area/:areaId', puestoController.getPuestosByArea);
router.get('/puestos/:id', puestoController.getPuestoById);
router.get('/areas/:id', areaController.getAreaById);
router.get('/areas/:id/ubicaciones', ubicacionController.getUbicacionesByArea);
router.post('/asistencias/guardar', asistenciaController.saveAsistencias);

module.exports = router;
