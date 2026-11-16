const express = require('express');
const router = express.Router();
const asistenciaController = require('../controllers/asistenciaController');
const { isAuthenticated, isNotSoloVista, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated);

router.get('/registro', isNotSoloVista, asistenciaController.showRegistroForm);
router.post('/guardar', isNotSoloVista, asistenciaController.saveAsistencias);
router.post('/corregir', isAdmin, asistenciaController.corregirAsistencia);
router.get('/historial', asistenciaController.listHistorial);

module.exports = router;
