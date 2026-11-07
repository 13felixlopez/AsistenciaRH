const express = require('express');
const router = express.Router();
const puestoController = require('../controllers/puestoController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated);

router.get('/', isAdmin, puestoController.listPuestos);
router.post('/crear', isAdmin, puestoController.createPuesto);
router.post('/editar', isAdmin, puestoController.updatePuesto);
router.post('/toggle/:id', isAdmin, puestoController.togglePuestoStatus);

module.exports = router;
