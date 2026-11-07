const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middlewares/auth');

router.get('/login', authController.showLogin);
router.post('/login', authController.login);
router.get('/logout', authController.logout);

router.get('/perfil', isAuthenticated, authController.showProfile);
router.post('/perfil/password', isAuthenticated, authController.changePassword);

module.exports = router;
