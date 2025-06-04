// In your routes file (e.g., routes/paymentRoutes.js)

const express = require('express');
const router = express.Router();
const { verifyPayment } = require('../controllers/paystackController');

router.post('/verify-payment', verifyPayment);

module.exports = router;
