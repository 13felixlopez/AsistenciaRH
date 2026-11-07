const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middlewares/auth');

router.post('/login', authController.login);
router.get('/me', isAuthenticated, authController.getMe);
router.put('/perfil', isAuthenticated, authController.updateProfile);
router.post('/perfil', isAuthenticated, authController.updateProfile);

module.exports = router;
