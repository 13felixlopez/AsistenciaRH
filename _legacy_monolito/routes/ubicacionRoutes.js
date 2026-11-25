const express = require('express');
const router = express.Router();
const ubicacionController = require('../controllers/ubicacionController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated);

// Obtener ubicaciones de un área (acceso para cualquier usuario autenticado para selects)
router.get('/area/:id', ubicacionController.getUbicacionesByArea);

// CRUD de Ubicaciones (Solo Administradores)
router.post('/crear', isAdmin, ubicacionController.createUbicacion);
router.post('/editar', isAdmin, ubicacionController.updateUbicacion);
router.post('/toggle/:id', isAdmin, ubicacionController.toggleUbicacion);

module.exports = router;
