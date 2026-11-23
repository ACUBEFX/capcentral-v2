
const express = require('express');
const router = express.Router();

const {
    getProfile,
    updateProfile,
    submitOrderRequest
} = require('../controllers/profileController');

const adminController = require('../controllers/adminController');

const { requireLogin } = require('../middlewares/authMiddleware');

const { generateToken } = require('../middlewares/csrfProtection');

// Generate a token for forms and page rendering
router.use('/profile', (req, res, next) => {
    res.locals.csrfToken = generateToken(req);
    next();
});

// Generate tokens for forms rendered on the My Deliveries page.
router.use('/my-deliveries', (req, res, next) => {
    res.locals.csrfToken = generateToken(req);
    next();
});

router.get('/profile', requireLogin, getProfile);
router.post('/profile', requireLogin, updateProfile);
router.post('/profile/order-request', requireLogin, submitOrderRequest);
router.get('/my-deliveries', requireLogin, adminController.customerDeliveries);

module.exports = router;
