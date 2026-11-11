
const express = require('express');
const router = express.Router();

const {
    getProfile,
    updateProfile,
    submitOrderRequest
} = require('../controllers/profileController');

const adminController = require('../controllers/adminController');

const { requireLogin } = require('../middlewares/authMiddleware');

const { csrfSync } = require('csrf-sync');

const {
    generateToken,
    csrfSynchronisedProtection
} = csrfSync({
    getTokenFromRequest: (req) => {
        if (
            req.is('application/x-www-form-urlencoded') ||
            req.is('multipart/form-data')
        ) {
            return req.body?._csrf;
        }

        return req.headers['x-csrf-token'];
    }
});

// Validate submitted CSRF tokens first
router.use('/profile', csrfSynchronisedProtection);

// Generate a token for forms and page rendering
router.use('/profile', (req, res, next) => {
    res.locals.csrfToken = generateToken(req);
    next();
});

// Protect and generate CSRF tokens for the My Deliveries page
router.use('/my-deliveries', csrfSynchronisedProtection);

router.use('/my-deliveries', (req, res, next) => {
    res.locals.csrfToken = generateToken(req);
    next();
});

router.get('/profile', requireLogin, getProfile);
router.post('/profile', requireLogin, updateProfile);
router.post('/profile/order-request', requireLogin, submitOrderRequest);
router.get('/my-deliveries', requireLogin, adminController.customerDeliveries);

module.exports = router;
