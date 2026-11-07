const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuarioController');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

router.use(isAuthenticated, isAdmin);

router.get('/', usuarioController.listUsuarios);
router.get('/nuevo', usuarioController.showCreateUser);
router.post('/nuevo', usuarioController.createUser);
router.get('/editar/:id', usuarioController.showEditUser);
router.post('/editar/:id', usuarioController.updateUser);
router.post('/toggle/:id', usuarioController.toggleUserStatus);

module.exports = router;
