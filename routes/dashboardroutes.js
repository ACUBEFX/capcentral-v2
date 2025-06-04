// routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const { dashboard } = require('../controllers/dashboardController');
const { requireLogin } = require('../middlewares/authMiddleware');

// Protect dashboard route with login check
router.get('/dashboard', requireLogin, dashboard);

module.exports = router;

