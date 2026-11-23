
const express = require('express');
const router = express.Router();

const checkoutController = require('../controllers/checkoutController');
const { generateToken } = require('../middlewares/csrfProtection');

// Require a valid customer session for shopping and checkout operations.
function requireCustomerLogin(req, res, next) {
    const userId = Number(req.session?.user?.id);

    if (Number.isSafeInteger(userId) && userId > 0) {
        return next();
    }

    // Browser requests go to the login page.
    if (req.accepts('html')) {
        return res.redirect('/login');
    }

    // API requests receive an authentication error.
    return res.status(401).json({
        success: false,
        message: 'Please log in to continue.'
    });
}

// Show checkout page
router.post(
    '/checkout',
    requireCustomerLogin,
    (req, res, next) => {
        res.locals.csrfToken = generateToken(req);
        next();
    },
    checkoutController.renderCheckoutPage
);

// Validate a promo code
router.post(
    '/checkout/promo',
    requireCustomerLogin,
    checkoutController.previewPromoCode
);

// Initialize Paystack payment
router.post(
    '/checkout/pay',
    requireCustomerLogin,
    checkoutController.handlePaystackInit
);

// Paystack redirects customer here after payment.
// Keep this public so payment confirmation can complete.
router.get(
    '/checkout/callback',
    checkoutController.handlePaystackCallback
);

// Paystack webhook must remain publicly accessible.
router.post(
    '/checkout/webhook',
    checkoutController.handlePaystackWebhook
);

module.exports = router;
