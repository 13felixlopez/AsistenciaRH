const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuarioController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated, isAdmin);

router.get('/', usuarioController.listUsuarios);
router.get('/form-data', usuarioController.getUserFormData);
router.get('/form-data/:id', usuarioController.getUserFormData);
router.post('/nuevo', usuarioController.createUser);
router.post('/editar/:id', usuarioController.updateUser);
router.post('/toggle/:id', usuarioController.toggleUserStatus);

module.exports = router;
