const bcrypt = require('bcryptjs');
const db = require('../models/database');
const jwt = require('jsonwebtoken');
const { sendPasswordResetEmail } = require('../utils/mailer'); // Assuming you imported the mailer

// Request password reset
const requestPasswordReset = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required.' });
    }

    try {
        const sql = 'SELECT * FROM signup WHERE email = ?';
        db.query(sql, [email], async (err, result) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Database error.' });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Email not found.' });
            }

            // Send password reset email
            try {
                await sendPasswordResetEmail(email);
                res.status(200).json({ message: 'Password reset link has been sent to your email.' });
            } catch (emailErr) {
                console.error('Email sending error:', emailErr);
                res.status(500).json({ message: 'Failed to send reset email.' });
            }
        });
    } catch (error) {
        console.error('Request password reset error:', error);
        res.status(500).json({ message: 'Something went wrong.' });
    }
};
// Handle new password submission
const resetPassword = async (req, res) => {
    const { token } = req.body; // Get the token from the request body (as sent from the form)
    const { password, confirmPassword } = req.body;

    // Validation checks
    if (!token) return res.status(400).json({ message: 'Token is missing or invalid.' });
    if (!password || !confirmPassword) return res.status(400).json({ message: 'Both password fields are required.' });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' });

    try {
        // Verifying the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Log the decoded token to check its content
        console.log('Decoded Token:', decoded);  // For debugging purposes

        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = 'UPDATE signup SET password = ? WHERE email = ?';
        db.query(sql, [hashedPassword, decoded.email], (err) => {
            if (err) {
                console.error('Error updating password:', err);
                return res.status(500).json({ message: 'Error updating password in the database.' });
            }

            res.status(200).json({ message: 'Password has been successfully reset.' });
        });
    } catch (error) {
        console.error('Reset password error:', error);

        // Handle token-specific errors
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(400).json({ message: 'Token has expired. Please request a new reset link.' });
        }

        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(400).json({ message: 'Token is invalid. Please request a new reset link.' });
        }

        // Catch all other errors
        res.status(500).json({ message: 'Something went wrong during the password reset.' });
    }
};


module.exports = {
    requestPasswordReset,
    resetPassword
};
