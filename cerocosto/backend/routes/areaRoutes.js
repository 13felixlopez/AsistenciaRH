const express = require('express');
const router = express.Router();
const areaController = require('../controllers/areaController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated);

// Gestión de áreas
router.get('/', areaController.listAreas);
router.get('/:id', areaController.getAreaById);
router.post('/crear', isAdmin, areaController.createArea);
router.post('/editar', isAdmin, areaController.updateArea);
router.post('/toggle/:id', isAdmin, areaController.toggleAreaStatus);

module.exports = router;
