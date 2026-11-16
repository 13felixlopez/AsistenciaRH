const express = require('express');
const router = express.Router();
const puestoController = require('../controllers/puestoController');
const { isAuthenticated, isAdmin, isNotSoloVista } = require('../middlewares/auth');

router.use(isAuthenticated);

// Plantilla de personal contratado (accesible para Responsables de Área y Admins)
router.get('/plantilla', isNotSoloVista, puestoController.getPlantillaData);
router.get('/plantilla/data', isNotSoloVista, puestoController.getPlantillaData);
router.get('/plantilla/data/:areaId', isNotSoloVista, puestoController.getPlantillaData);
router.post('/plantilla/guardar', isNotSoloVista, puestoController.savePlantilla);

// Catálogo general de puestos
router.get('/', puestoController.listPuestos);
router.get('/area/:areaId', puestoController.getPuestosByArea);
router.get('/:id', puestoController.getPuestoById);
router.post('/crear', isAdmin, puestoController.createPuesto);
router.post('/editar', isAdmin, puestoController.updatePuesto);
router.post('/toggle/:id', isAdmin, puestoController.togglePuestoStatus);

module.exports = router;
