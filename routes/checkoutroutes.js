const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');

// POST /checkout: Render checkout page with cart/total
router.post('/checkout', checkoutController.renderCheckoutPage);

// POST /checkout/pay: Initialize Paystack payment
router.post('/checkout/pay', checkoutController.handlePaystackInit);

// GET /checkout/callback: Paystack payment callback
router.get('/checkout/callback', checkoutController.handlePaystackCallback);

module.exports = router;