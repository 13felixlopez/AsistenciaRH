const express = require('express');
const router = express.Router();
const areaController = require('../controllers/areaController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated);

// Solo administradores pueden gestionar áreas
router.get('/', isAdmin, areaController.listAreas);
router.post('/crear', isAdmin, areaController.createArea);
router.post('/editar', isAdmin, areaController.updateArea);
router.post('/toggle/:id', isAdmin, areaController.toggleAreaStatus);

module.exports = router;
