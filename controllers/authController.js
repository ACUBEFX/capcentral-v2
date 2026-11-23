const bcryptjs = require('bcryptjs');
const db = require('../models/database');
const jwt = require('jsonwebtoken');
const path = require ('path');
const { sendVerificationEmail } = require('../utils/mailer');

// Signup Controller
const signup = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Check if email exists
        const checkSql = 'SELECT * FROM signup WHERE email = ?';
        db.query(checkSql, [email], async (err, result) => {
            if (err) return res.status(500).send('Database error while checking email.');
            if (result.length > 0) return res.status(400).send('Email already exists.');

            // Hash password
            const hashedPassword = await bcryptjs.hash(password, 10);

            const insertSql = 'INSERT INTO signup (username, email, password) VALUES (?, ?, ?)';
            db.query(insertSql, [username, email, hashedPassword], async (err, result) => {
              if (err) {
                  console.error('ERROR SAVING USER:', err);
                  return res.status(500).send('Error saving user.');
              }
                
                await sendVerificationEmail(email);
                res.render('success');
            });
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).send('Server error.');
    }
};

// Email Verification Controller
const verifyEmail = async (req, res) => {
    const { token } = req.query;

    if (!token) return res.status(400).send('No token provided.');

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const email = decoded.email;

        const updateSql = 'UPDATE signup SET is_verified = 1 WHERE email = ?';
        db.query(updateSql, [email], (err, result) => {
            if (err) return res.status(500).send('Error verifying email.');

            // Show success + redirect to login
            res.send(
                `
                <html>
                    <head>
                        <meta http-equiv="refresh" content="3;url=/login" />
                        <style>
                            body { font-family: sans-serif; text-align: center; margin-top: 100px; color: #333; }
                        </style>
                    </head>
                    <body>
                        <h1>Email successfully verified!</h1>
                        <p>Redirecting to login page...</p>
                    </body>
                </html>`
            );
        });
    } catch (error) {
        res.status(500).send('Invalid or expired token.');
    }
};





const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const sql = 'SELECT * FROM signup WHERE email = ?';

        db.query(sql, [email], async (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Internal server error.');
            }

            if (results.length === 0) {
                return res.status(400).send('Email not found.');
            }

            const user = results[0];
            const isMatch = await bcryptjs.compare(password, user.password);

            if (!isMatch) {
                return res.status(400).send('Incorrect password.');
            }

            if (!user.is_verified) {
                return res.status(403).send('Please verify your email before logging in.');
            }

            req.session.regenerate((regenerateError) => {
                if (regenerateError) {
                    console.error('Session regeneration error:', regenerateError);
                    return res.status(500).send('Unable to complete login.');
                }

                req.session.user = {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    phone_number: user.phone_number || '',
                    address: user.address || ''
                };

                req.session.save((saveError) => {
                    if (saveError) {
                        console.error('Session save error:', saveError);
                        return res.status(500).send('Unable to complete login.');
                    }

                    return res.redirect('/products');
                });
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).send('Server error.');
    }
};



const logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).send('Error logging out.');
        }

        res.clearCookie('connect.sid', {
            httpOnly: true,
            sameSite: 'lax',
            secure: req.secure,
            path: '/'
        });
        return res.sendFile(
            path.join(__dirname, '..', 'public', 'homepage.html')
        );
    });
};


module.exports = {
     login, 
     logout ,
    signup,
    verifyEmail
};
