const express = require('express');
const router = express.Router();
const { verifyPayment } = require('../controllers/paymentController');

// POST /api/payment/verify
router.post('/verifyPayment', verifyPayment);

module.exports = router;
