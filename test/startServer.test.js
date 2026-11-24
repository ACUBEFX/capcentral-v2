'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startServer } = require('../services/startServer');

function createHarness() {
    const events = [];
    const server = new EventEmitter();
    let listeningCallback;

    const app = {
        listen(port, host, callback) {
            events.push('listen');
            assert.equal(port, 8123);
            assert.equal(host, '0.0.0.0');
            listeningCallback = callback;
            return server;
        }
    };

    const reservationExpiryService = {
        start() {
            events.push('expiry');
        }
    };

    const logger = {
        log() {}
    };

    return {
        events,
        server,
        app,
        reservationExpiryService,
        logger,
        signalListening() {
            assert.equal(typeof listeningCallback, 'function');
            listeningCallback();
        }
    };
}

test('disabled MySQL sessions start listening without waiting for a store', async () => {
    const h = createHarness();

    const startup = startServer({
        app: h.app,
        port: 8123,
        sessionStore: undefined,
        reservationExpiryService: h.reservationExpiryService,
        logger: h.logger
    });

    assert.deepEqual(h.events, ['listen']);

    h.signalListening();

    const server = await startup;

    assert.equal(server, h.server);
    assert.deepEqual(h.events, ['listen', 'expiry']);
});

test('enabled MySQL sessions must be ready before HTTP listening', async () => {
    const h = createHarness();
    let resolveReady;

    const sessionStore = {
        onReady() {
            h.events.push('ready');
            return new Promise(resolve => {
                resolveReady = resolve;
            });
        }
    };

    const startup = startServer({
        app: h.app,
        port: 8123,
        sessionStore,
        reservationExpiryService: h.reservationExpiryService,
        logger: h.logger
    });

    assert.deepEqual(h.events, ['ready']);

    resolveReady();
    await Promise.resolve();

    assert.deepEqual(h.events, ['ready', 'listen']);

    h.signalListening();

    const server = await startup;

    assert.equal(server, h.server);
    assert.deepEqual(h.events, ['ready', 'listen', 'expiry']);
});

test('session-store initialization failure prevents listening and expiry startup', async () => {
    const h = createHarness();
    const failure = new Error('Session store initialization failed');

    const sessionStore = {
        onReady() {
            h.events.push('ready');
            return Promise.reject(failure);
        }
    };

    await assert.rejects(
        startServer({
            app: h.app,
            port: 8123,
            sessionStore,
            reservationExpiryService: h.reservationExpiryService,
            logger: h.logger
        }),
        error => error === failure
    );

    assert.deepEqual(h.events, ['ready']);
});

test('HTTP listening failure prevents reservation expiry startup', async () => {
    const h = createHarness();
    const failure = new Error('HTTP listen failed');

    const startup = startServer({
        app: h.app,
        port: 8123,
        sessionStore: undefined,
        reservationExpiryService: h.reservationExpiryService,
        logger: h.logger
    });

    h.server.emit('error', failure);

    await assert.rejects(
        startup,
        error => error === failure
    );

    assert.deepEqual(h.events, ['listen']);
});