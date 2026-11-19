const express = require('express');
const router = express.Router();
const { signup, verifyEmail, login, logout} = require('../controllers/authController');
const validateSignupInput = require('../middlewares/signupValidation');
const validateLoginInput = require('../middlewares/loginValidation');
const path = require('path');

// Route to serve signup page
router.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'signup.html'));
});

// Route to handle signup form submission
router.post('/signup', validateSignupInput, signup);

// Route to handle email verification
router.get('/verify-email', verifyEmail);


// Serve the login HTML form
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

// Handle login form submission
router.post('/login',  validateLoginInput, login);
// Logout changes session state and therefore requires a CSRF-protected POST.
router.post('/logout', logout);
    

module.exports = router;

