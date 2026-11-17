
const express = require('express');
const router = express.Router();

const checkoutController = require('../controllers/checkoutController');




// Show checkout page
router.post('/checkout', checkoutController.renderCheckoutPage);

// Validate a promo code for the current server-priced cart.
router.post('/checkout/promo', checkoutController.previewPromoCode);

// Initialize Paystack payment
router.post('/checkout/pay', checkoutController.handlePaystackInit);

// Paystack redirects customer here after payment
router.get('/checkout/callback', checkoutController.handlePaystackCallback);

// Paystack webhook for successful payments
router.post('/checkout/webhook', checkoutController.handlePaystackWebhook);

module.exports = router;

