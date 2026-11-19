'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const bcryptjs = require('bcryptjs');
const db = require('../models/database');
const { createSessionSecurity } = require('../config/sessionSecurity');

const TEST_SECRET = 'test-only-session-secret-93f0a17c';

test('production refuses a missing or weak session secret', () => {
    assert.throws(
        () => createSessionSecurity({ NODE_ENV: 'production' }),
        /strong SESSION_SECRET/
    );
    assert.throws(
        () => createSessionSecurity({
            RAILWAY_ENVIRONMENT_NAME: 'staging',
            SESSION_SECRET: 'x'.repeat(64)
        }),
        /strong SESSION_SECRET/
    );
});

test('production configures one Railway proxy hop and secure cookies', () => {
    const config = createSessionSecurity({
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        SESSION_SECRET: TEST_SECRET
    });

    assert.equal(config.trustProxy, 1);
    assert.equal(config.secureCookie, true);
    assert.equal(config.secret, TEST_SECRET);
});

test('local HTTP config keeps the cookie non-secure and trusts no proxy', () => {
    const config = createSessionSecurity({
        NODE_ENV: 'development',
        SESSION_SECRET: TEST_SECRET
    });

    assert.equal(config.trustProxy, false);
    assert.equal(config.secureCookie, false);
});

async function requestSessionCookie(config, forwardedProto) {
    const app = express();
    app.set('trust proxy', config.trustProxy);
    app.use(session({
        secret: config.secret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.secureCookie
        }
    }));
    app.get('/', (req, res) => {
        req.session.visited = true;
        res.send('ok');
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
        const address = server.address();
        const headers = forwardedProto ? { 'X-Forwarded-Proto': forwardedProto } : {};
        return await new Promise((resolve, reject) => {
            http.get({ host: '127.0.0.1', port: address.port, path: '/', headers }, res => {
                res.resume();
                res.on('end', () => resolve(res.headers['set-cookie']?.[0] || ''));
            }).on('error', reject);
        });
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test('production HTTPS session cookie includes Secure', async () => {
    const config = createSessionSecurity({
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        SESSION_SECRET: TEST_SECRET
    });
    const cookie = await requestSessionCookie(config, 'https');

    assert.match(cookie, /; Secure(?:;|$)/i);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
});

test('local HTTP session cookie remains usable without Secure', async () => {
    const config = createSessionSecurity({
        NODE_ENV: 'development',
        SESSION_SECRET: TEST_SECRET
    });
    const cookie = await requestSessionCookie(config);

    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /; Secure(?:;|$)/i);
});

function createResponse() {
    return {
        statusCode: null,
        body: null,
        redirectPath: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
        redirect(path) {
            this.redirectPath = path;
            return this;
        }
    };
}

async function runLogin({ controller, user, passwordMatch }) {
    const previousQuery = db.query;
    const previousCompare = bcryptjs.compare;
    const initialSessionId = 'pre-auth-session-id';
    let queryCallback;
    let regenerationCount = 0;
    const req = {
        body: { email: user.email, password: 'provided-password' },
        session: {
            id: initialSessionId,
            regenerate(callback) {
                regenerationCount += 1;
                this.id = 'new-session-id';
                this.user = undefined;
                callback(null);
            },
            save(callback) {
                callback(null);
            }
        }
    };
    const res = createResponse();

    db.query = (sql, values, callback) => { queryCallback = callback; };
    bcryptjs.compare = async () => passwordMatch;

    try {
        await controller(req, res);
        assert.equal(typeof queryCallback, 'function');
        queryCallback(null, [user]);
        await new Promise(resolve => setImmediate(resolve));
        return { req, res, initialSessionId, regenerationCount };
    } finally {
        db.query = previousQuery;
        bcryptjs.compare = previousCompare;
    }
}

test('customer login regenerates the session and keeps its redirect', async () => {
    const authController = require('../controllers/authController');
    const result = await runLogin({
        controller: authController.login,
        user: {
            id: 17,
            username: 'customer-test',
            email: 'customer@example.invalid',
            password: 'stored-hash',
            is_verified: 1
        },
        passwordMatch: true
    });

    assert.equal(result.regenerationCount, 1);
    assert.notEqual(result.req.session.id, result.initialSessionId);
    assert.equal(result.req.session.user.id, 17);
    assert.equal(result.res.redirectPath, '/products');
});

test('admin login regenerates the session and keeps its redirect', async () => {
    const adminController = require('../controllers/adminController');
    const result = await runLogin({
        controller: adminController.login,
        user: {
            id: 23,
            username: 'admin-test',
            email: 'admin@example.invalid',
            password: 'stored-hash',
            is_admin: 1,
            is_verified: 1,
            is_active: 1
        },
        passwordMatch: true
    });

    assert.equal(result.regenerationCount, 1);
    assert.notEqual(result.req.session.id, result.initialSessionId);
    assert.equal(result.req.session.user.id, 23);
    assert.equal(result.res.redirectPath, '/admin');
});

test('failed customer and admin logins do not regenerate or establish auth', async () => {
    const authController = require('../controllers/authController');
    const adminController = require('../controllers/adminController');
    const customer = await runLogin({
        controller: authController.login,
        user: {
            id: 17,
            username: 'customer-test',
            email: 'customer@example.invalid',
            password: 'stored-hash',
            is_verified: 1
        },
        passwordMatch: false
    });
    const admin = await runLogin({
        controller: adminController.login,
        user: {
            id: 23,
            username: 'admin-test',
            email: 'admin@example.invalid',
            password: 'stored-hash',
            is_admin: 1,
            is_verified: 1,
            is_active: 1
        },
        passwordMatch: false
    });

    for (const result of [customer, admin]) {
        assert.equal(result.regenerationCount, 0);
        assert.equal(result.req.session.user, undefined);
        assert.equal(result.req.session.id, result.initialSessionId);
        assert.equal(result.res.redirectPath, null);
    }
});
