const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { isAuthenticated } = require('../middlewares/auth');

router.use(isAuthenticated);

router.get('/', reporteController.showReportes);
router.get('/exportar/excel', reporteController.exportExcel);

module.exports = router;
