// In your routes file (e.g., routes/paymentRoutes.js)

const express = require('express');
const router = express.Router();
const {
  initializeServicePayment,
  verifyPayment
} = require('../controllers/paystackController');

router.post('/initialize-service-payment', initializeServicePayment);
router.post('/verify-payment', verifyPayment);

module.exports = router;
