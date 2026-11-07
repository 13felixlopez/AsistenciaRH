const express = require('express');
const router = express.Router();
const puestoController = require('../controllers/puestoController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated);

router.get('/', puestoController.listPuestos);
router.get('/area/:areaId', puestoController.getPuestosByArea);
router.get('/:id', puestoController.getPuestoById);
router.post('/crear', isAdmin, puestoController.createPuesto);
router.post('/editar', isAdmin, puestoController.updatePuesto);
router.post('/toggle/:id', isAdmin, puestoController.togglePuestoStatus);

module.exports = router;
