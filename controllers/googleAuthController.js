
'use strict';

const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../models/database');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL ||
    'http://localhost:8000/auth/google/callback';

const googleClient = new OAuth2Client(
    CLIENT_ID,
    CLIENT_SECRET,
    CALLBACK_URL
);

const pool = db.promise();

function redirectToLogin(res, reason) {
    return res.redirect(`/login?google=${encodeURIComponent(reason)}`);
}

function createUsernameBase(name, email) {
    let base = String(name || email.split('@')[0])
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._ ]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 14);

    if (base.length < 3) {
        base = 'user';
    }

    return base;
}

async function createUniqueUsername(connection, name, email) {
    const base = createUsernameBase(name, email);

    for (let attempt = 0; attempt < 20; attempt++) {
        const suffix = crypto.randomInt(1000, 9999).toString();
        const username = `${base.slice(0, 15)}_${suffix}`.slice(0, 20);

        const [rows] = await connection.execute(
            'SELECT id FROM signup WHERE username = ? LIMIT 1',
            [username]
        );

        if (rows.length === 0) {
            return username;
        }
    }

    throw new Error('Could not generate a unique username.');
}

function saveSession(req, user) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((regenerateError) => {
            if (regenerateError) {
                return reject(regenerateError);
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                email: user.email,
                phone_number: user.phone_number || null,
                address: user.address || null,
                is_admin: user.is_admin || 0
            };

            req.session.save((saveError) => {
                if (saveError) {
                    return reject(saveError);
                }

                resolve();
            });
        });
    });
}

exports.googleLogin = (req, res) => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        console.error('Google OAuth credentials are not configured.');
        return redirectToLogin(res, 'configuration_error');
    }

    const state = crypto.randomBytes(32).toString('hex');

    req.session.googleOAuthState = state;

    req.session.save((error) => {
        if (error) {
            console.error('Could not save Google OAuth session:', error);
            return redirectToLogin(res, 'session_error');
        }

        const authorizationUrl = googleClient.generateAuthUrl({
            access_type: 'online',
            scope: ['openid', 'email', 'profile'],
            prompt: 'select_account',
            state
        });

        return res.redirect(authorizationUrl);
    });
};

exports.googleCallback = async (req, res) => {
    let connection;

    try {
        if (req.query.error) {
            return redirectToLogin(res, 'cancelled');
        }

        const receivedState = req.query.state;
        const savedState = req.session.googleOAuthState;

        delete req.session.googleOAuthState;

        if (
            typeof receivedState !== 'string' ||
            typeof savedState !== 'string' ||
            receivedState.length !== savedState.length ||
            !crypto.timingSafeEqual(
                Buffer.from(receivedState),
                Buffer.from(savedState)
            )
        ) {
            return redirectToLogin(res, 'invalid_state');
        }

        if (!req.query.code) {
            return redirectToLogin(res, 'missing_code');
        }

        const { tokens } = await googleClient.getToken({
            code: req.query.code,
            redirect_uri: CALLBACK_URL
        });

        if (!tokens.id_token) {
            return redirectToLogin(res, 'token_error');
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: CLIENT_ID
        });

        const googleUser = ticket.getPayload();

        if (
            !googleUser ||
            !googleUser.sub ||
            !googleUser.email ||
            googleUser.email_verified !== true
        ) {
            return redirectToLogin(res, 'email_not_verified');
        }

        const googleSub = googleUser.sub;
        const email = googleUser.email.trim().toLowerCase();

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // First check whether this Google account is already linked.
        const [linkedUsers] = await connection.execute(
            `SELECT id, username, email, phone_number, address,
                    is_admin, is_active
             FROM signup
             WHERE google_sub = ?
             LIMIT 1`,
            [googleSub]
        );

        let user;

        if (linkedUsers.length > 0) {
            user = linkedUsers[0];

            if (!user.is_active) {
                await connection.rollback();
                return redirectToLogin(res, 'account_inactive');
            }
        } else {
            // Do not automatically link Google to an existing email account.
            const [emailUsers] = await connection.execute(
                'SELECT id FROM signup WHERE email = ? LIMIT 1',
                [email]
            );

            if (emailUsers.length > 0) {
                await connection.rollback();
                return redirectToLogin(res, 'account_exists');
            }

            const username = await createUniqueUsername(
                connection,
                googleUser.name,
                email
            );

            // Google-only accounts still need a password value because
            // the existing signup table requires one.
            const randomPassword = crypto.randomBytes(32).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 12);

            const [insertResult] = await connection.execute(
                `INSERT INTO signup
                    (username, email, password, is_verified, google_sub)
                 VALUES (?, ?, ?, 1, ?)`,
                [username, email, hashedPassword, googleSub]
            );

            const [newUsers] = await connection.execute(
                `SELECT id, username, email, phone_number, address,
                        is_admin, is_active
                 FROM signup
                 WHERE id = ?
                 LIMIT 1`,
                [insertResult.insertId]
            );

            if (!newUsers.length) {
                throw new Error('Could not retrieve the new Google account.');
            }

            user = newUsers[0];
        }

        await connection.commit();

        if (!user.is_active) {
            return redirectToLogin(res, 'account_inactive');
        }

        await saveSession(req, user);

        return res.redirect('/products');

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Google OAuth rollback error:', rollbackError);
            }
        }

        console.error('Google OAuth callback error:', error);
        return redirectToLogin(res, 'authentication_failed');

    } finally {
        if (connection) {
            connection.release();
        }
    }
};
