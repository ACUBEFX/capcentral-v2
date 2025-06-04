const express = require('express');
const router = express.Router();
const { requestPasswordReset, resetPassword } = require('../controllers/resetPasswordController');

// Route to request a password reset (POST - sending email with token)
router.post('/request-password-reset', requestPasswordReset);

// Route to render the reset form (GET - shows the form with token)
router.get('/reset-password', (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ message: 'Token is missing or invalid.' });
    }

    res.render('reset', { token });  // Rendering reset.ejs with the token
});

// Route to handle the new password submission (POST - reset the password)
router.post('/reset-password', resetPassword);

module.exports = router;
