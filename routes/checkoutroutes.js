
const express = require('express');
const router = express.Router();

const checkoutController = require('../controllers/checkoutController');
const { requireLogin } = require('../middlewares/authMiddleware');
const adminController = require('../controllers/adminController');

// Signed-in customer delivery tracking
router.get('/my-deliveries', requireLogin, adminController.customerDeliveries);

// Show checkout page
router.post('/checkout', checkoutController.renderCheckoutPage);

// Initialize Paystack payment
router.post('/checkout/pay', checkoutController.handlePaystackInit);

// Paystack redirects customer here after payment
router.get('/checkout/callback', checkoutController.handlePaystackCallback);

// Paystack webhook for successful payments
router.post('/checkout/webhook', checkoutController.handlePaystackWebhook);

module.exports = router;

