'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const checkoutController = require('../controllers/checkoutController');
const {
    csrfSynchronisedProtection,
    generateToken
} = require('../middlewares/csrfProtection');

const SESSION_SECRET = 'csrf-test-session-secret-84b12d7f';
const PAYSTACK_TEST_SECRET = 'csrf-test-paystack-secret';
const protectedBrowserPaths = [
    '/signup',
    '/login',
    '/logout',
    '/admin/login',
    '/admin/logout',
    '/admin/customers/1/edit',
    '/admin/customers/1/active',
    '/admin/customers/1/delete',
    '/admin/deliveries/1/status',
    '/admin/deliveries/1/details',
    '/admin/orders/1/status',
    '/admin/services/1/status',
    '/checkout',
    '/checkout/promo',
    '/checkout/pay',
    '/checkout/webhook-evil',
    '/profile',
    '/profile/order-request',
    '/admin/promos',
    '/admin/promos/1/edit',
    '/admin/promos/1/toggle',
    '/admin/categories',
    '/admin/categories/1/toggle',
    '/admin/categories/1/delete',
    '/admin/categories/1/restore',
    '/admin/products',
    '/admin/products/1/edit',
    '/admin/products/1/toggle',
    '/admin/products/1/stock',
    '/admin/order-requests/1/review',
    '/contact',
    '/request-password-reset',
    '/reset-password',
    '/verify-payment',
    '/initialize-service-payment',
    '/verifyPayment',
    '/pay'
];

function createTestApp() {
    const app = express();
    app.use(session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false
    }));
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json({
        verify: (req, res, buffer) => {
            if (req.path === '/checkout/webhook') req.rawBody = Buffer.from(buffer);
        }
    }));
    app.use(csrfSynchronisedProtection);

    app.get('/csrf-token', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ csrfToken: generateToken(req) });
    });
    app.get('/read-only', (req, res) => res.sendStatus(200));

    for (const routePath of protectedBrowserPaths) {
        app.post(routePath, (req, res) => res.sendStatus(204));
    }

    app.post('/checkout/webhook', checkoutController.handlePaystackWebhook);
    app.use((error, req, res, next) => {
        if (error.code === 'EBADCSRFTOKEN') return res.sendStatus(403);
        return res.sendStatus(500);
    });
    return app;
}

async function startTestServer(app) {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
}

async function sendRequest(server, {
    method = 'GET',
    path = '/',
    cookie,
    token,
    body,
    contentType
} = {}) {
    const address = server.address();
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (token) headers['X-CSRF-Token'] = token;
    if (body !== undefined) {
        headers['Content-Length'] = Buffer.byteLength(body);
        headers['Content-Type'] = contentType || 'application/x-www-form-urlencoded';
    }

    return new Promise((resolve, reject) => {
        const request = http.request({
            host: '127.0.0.1',
            port: address.port,
            method,
            path,
            headers
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        request.on('error', reject);
        if (body !== undefined) request.write(body);
        request.end();
    });
}

async function getSessionToken(server) {
    const response = await sendRequest(server, { path: '/csrf-token' });
    assert.equal(response.statusCode, 200);
    const cookie = response.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie);
    return { cookie, token: JSON.parse(response.body).csrfToken };
}

test('unsafe browser routes reject missing tokens, including login and checkout', async t => {
    const server = await startTestServer(createTestApp());
    t.after(() => new Promise(resolve => server.close(resolve)));

    for (const path of protectedBrowserPaths) {
        const response = await sendRequest(server, { method: 'POST', path });
        assert.equal(response.statusCode, 403, `${path} must reject a missing token`);
    }

    const trailingSlashWebhook = await sendRequest(server, {
        method: 'POST',
        path: '/checkout/webhook/'
    });
    assert.equal(trailingSlashWebhook.statusCode, 403);
});

test('invalid token is rejected and a valid session token is accepted', async t => {
    const server = await startTestServer(createTestApp());
    t.after(() => new Promise(resolve => server.close(resolve)));
    const { cookie, token } = await getSessionToken(server);

    const invalid = await sendRequest(server, {
        method: 'POST',
        path: '/checkout/pay',
        cookie,
        token: 'not-the-session-token'
    });
    assert.equal(invalid.statusCode, 403);

    const validForm = await sendRequest(server, {
        method: 'POST',
        path: '/checkout/pay',
        cookie,
        body: `_csrf=${encodeURIComponent(token)}`
    });
    assert.equal(validForm.statusCode, 204);

    const validHeader = await sendRequest(server, {
        method: 'POST',
        path: '/checkout/promo',
        cookie,
        token
    });
    assert.equal(validHeader.statusCode, 204);
});

test('a token issued to another session is rejected', async t => {
    const server = await startTestServer(createTestApp());
    t.after(() => new Promise(resolve => server.close(resolve)));
    const firstSession = await getSessionToken(server);
    const secondSession = await getSessionToken(server);

    const response = await sendRequest(server, {
        method: 'POST',
        path: '/admin/promos',
        cookie: firstSession.cookie,
        token: secondSession.token
    });
    assert.equal(response.statusCode, 403);
});

test('normal GET requests remain unaffected', async t => {
    const server = await startTestServer(createTestApp());
    t.after(() => new Promise(resolve => server.close(resolve)));

    const response = await sendRequest(server, { path: '/read-only' });
    assert.equal(response.statusCode, 200);
});

test('Paystack webhook accepts valid HMAC and rejects invalid HMAC without CSRF token', async t => {
    const previousSecret = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_TEST_SECRET;
    const server = await startTestServer(createTestApp());
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        if (previousSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
        else process.env.PAYSTACK_SECRET_KEY = previousSecret;
    });

    const body = JSON.stringify({ event: 'test.ignored' });
    const validSignature = crypto
        .createHmac('sha512', PAYSTACK_TEST_SECRET)
        .update(body)
        .digest('hex');
    const signedValidRequest = await new Promise((resolve, reject) => {
        const address = server.address();
        const request = http.request({
            host: '127.0.0.1',
            port: address.port,
            method: 'POST',
            path: '/checkout/webhook',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'x-paystack-signature': validSignature
            }
        }, response => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end(body);
    });
    assert.equal(signedValidRequest, 200);

    const invalidSignature = '0'.repeat(128);
    const signedInvalidRequest = await new Promise((resolve, reject) => {
        const address = server.address();
        const request = http.request({
            host: '127.0.0.1',
            port: address.port,
            method: 'POST',
            path: '/checkout/webhook',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'x-paystack-signature': invalidSignature
            }
        }, response => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end(body);
    });
    assert.equal(signedInvalidRequest, 401);
});
