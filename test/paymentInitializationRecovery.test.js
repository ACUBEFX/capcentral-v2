const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeAttempt } = require('../services/paymentAttemptLifecycle');
const { recoverPayment } = require('../services/paymentRecovery');

test('persists in_flight before calling Paystack with the exact reference', async () => {
    const events = [];
    const reference = 'CC-merchant-ref-123';

    const response = await initializeAttempt({
        reference,
        markInFlight: async value => events.push(['in_flight', value]),
        initialize: async value => {
            events.push(['paystack', value]);
            return { reference: value, authorization_url: 'https://checkout.invalid' };
        },
        markInitialized: async value => events.push(['initialized', value]),
        rejectAndRelease: async () => assert.fail('unexpected rejection'),
        isDefinitiveRejection: () => false,
        validateResponse: responseData => assert.ok(responseData.authorization_url)
    });

    assert.deepEqual(events, [
        ['in_flight', reference],
        ['paystack', reference],
        ['initialized', reference]
    ]);
    assert.equal(response.reference, reference);
});

test('does not call Paystack when persisting in_flight fails', async () => {
    let initialized = false;

    await assert.rejects(initializeAttempt({
        reference: 'CC-ref',
        markInFlight: async () => { throw new Error('database unavailable'); },
        initialize: async () => { initialized = true; },
        markInitialized: async () => {},
        rejectAndRelease: async () => {},
        isDefinitiveRejection: () => false,
        validateResponse: () => {}
    }), /database unavailable/);

    assert.equal(initialized, false);
});

test('mismatched initialization reference remains ambiguous and is not marked initialized', async () => {
    let state = 'in_flight';
    let releases = 0;

    await assert.rejects(initializeAttempt({
        reference: 'CC-expected',
        markInFlight: async () => {},
        initialize: async () => ({
            reference: 'CC-different',
            authorization_url: 'https://checkout.invalid'
        }),
        markInitialized: async () => { state = 'initialized'; },
        rejectAndRelease: async () => { releases += 1; },
        isDefinitiveRejection: () => false,
        validateResponse: () => {}
    }), /mismatched payment reference/);

    assert.equal(state, 'in_flight');
    assert.equal(releases, 0);
});

test('lost initialization response stays in_flight without releasing reservations', async () => {
    let state = 'prepared';
    let releases = 0;

    await assert.rejects(initializeAttempt({
        reference: 'CC-timeout',
        markInFlight: async () => { state = 'in_flight'; },
        initialize: async () => { throw new Error('socket timeout'); },
        markInitialized: async () => { state = 'initialized'; },
        rejectAndRelease: async () => { releases += 1; },
        isDefinitiveRejection: () => false,
        validateResponse: () => {}
    }), /socket timeout/);

    assert.equal(state, 'in_flight');
    assert.equal(releases, 0);
});

test('failure to persist initialized leaves the pre-persisted attempt recoverable', async () => {
    let state = 'prepared';
    let releases = 0;

    await assert.rejects(initializeAttempt({
        reference: 'CC-state-write',
        markInFlight: async () => { state = 'in_flight'; },
        initialize: async reference => ({ reference, authorization_url: 'https://checkout.invalid' }),
        markInitialized: async () => { throw new Error('database write failed'); },
        rejectAndRelease: async () => { releases += 1; },
        isDefinitiveRejection: () => false,
        validateResponse: () => {}
    }), /database write failed/);

    assert.equal(state, 'in_flight');
    assert.equal(releases, 0);
});

test('definitive initialization rejection records rejection before surfacing the error', async () => {
    const events = [];
    const rejection = Object.assign(new Error('invalid request'), {
        response: { status: 400, data: { status: false } }
    });

    await assert.rejects(initializeAttempt({
        reference: 'CC-rejected',
        markInFlight: async () => events.push('in_flight'),
        initialize: async () => { throw rejection; },
        markInitialized: async () => events.push('initialized'),
        rejectAndRelease: async () => events.push('rejected-and-released'),
        isDefinitiveRejection: error => error.response?.status === 400,
        validateResponse: () => {}
    }), /invalid request/);

    assert.deepEqual(events, ['in_flight', 'rejected-and-released']);
});

test('prepared and rejected attempts use only their safe release paths', async () => {
    const calls = [];
    const common = {
        reference: 'CC-prepared',
        reservationToken: 'token-1',
        verify: async () => assert.fail('must not verify'),
        associate: async () => assert.fail('must not associate'),
        complete: async () => assert.fail('must not complete'),
        releasePrepared: async ref => calls.push(['prepared', ref]),
        releaseRejected: async ref => calls.push(['rejected', ref]),
        releaseTerminal: async ref => calls.push(['terminal', ref])
    };

    assert.equal(await recoverPayment({ ...common, state: 'prepared' }), 'released-prepared');
    assert.equal(await recoverPayment({ ...common, state: 'rejected' }), 'released-rejected');
    assert.deepEqual(calls, [
        ['prepared', 'CC-prepared'],
        ['rejected', 'CC-prepared']
    ]);
});

for (const state of ['in_flight', 'initialized', 'legacy']) {
    test(`${state} attempts verify the durable reference`, async () => {
        let verifiedReference;
        const result = await recoverPayment({
            state,
            reference: 'CC-verify',
            reservationToken: 'token-verify',
            verify: async reference => {
                verifiedReference = reference;
                return {
                    reference,
                    status: 'pending',
                    metadata: { reservationToken: 'token-verify' }
                };
            },
            associate: async () => assert.fail('pending payment is not associated'),
            complete: async () => assert.fail('pending payment is not completed'),
            releasePrepared: async () => assert.fail('must not release'),
            releaseRejected: async () => assert.fail('must not release'),
            releaseTerminal: async () => assert.fail('must not release')
        });

        assert.equal(result, 'pending');
        assert.equal(verifiedReference, 'CC-verify');
    });
}

for (const verification of [
    { name: 'not found', verify: async () => { throw new Error('not found'); } },
    { name: 'timeout', verify: async () => { throw new Error('timeout'); } },
    { name: 'verification error', verify: async () => { throw new Error('gateway unavailable'); } },
    { name: 'unknown status', verify: async reference => ({ reference, status: 'processing', metadata: { reservationToken: 'token-safe' } }) },
    { name: 'reference mismatch', verify: async () => ({ reference: 'other-ref', status: 'success', metadata: { reservationToken: 'token-safe' } }) },
    { name: 'token mismatch', verify: async reference => ({ reference, status: 'success', metadata: { reservationToken: 'other-token' } }) }
]) {
    test(`${verification.name} verification never releases reservations`, async () => {
        let released = false;
        const result = await recoverPayment({
            state: 'in_flight',
            reference: 'CC-safe',
            reservationToken: 'token-safe',
            verify: verification.verify,
            associate: async () => assert.fail('untrusted payment must not associate'),
            complete: async () => assert.fail('untrusted payment must not complete'),
            releasePrepared: async () => { released = true; },
            releaseRejected: async () => { released = true; },
            releaseTerminal: async () => { released = true; }
        });

        assert.ok(['unverifiable', 'verification-mismatch', 'pending'].includes(result));
        assert.equal(released, false);
    });
}

test('verified successful payment associates and completes; terminal failure associates before release', async () => {
    const calls = [];
    const base = {
        state: 'initialized',
        reference: 'CC-success',
        reservationToken: 'token-success',
        verify: async reference => ({
            reference,
            status: 'success',
            metadata: { reservationToken: 'token-success' }
        }),
        associate: async () => calls.push('associate'),
        complete: async () => calls.push('complete'),
        releasePrepared: async () => calls.push('release-prepared'),
        releaseRejected: async () => calls.push('release-rejected'),
        releaseTerminal: async () => calls.push('release-terminal')
    };

    assert.equal(await recoverPayment(base), 'completed');
    assert.deepEqual(calls, ['associate', 'complete']);

    calls.length = 0;
    assert.equal(await recoverPayment({
        ...base,
        verify: async reference => ({
            reference,
            status: 'abandoned',
            metadata: { reservationToken: 'token-success' }
        })
    }), 'released-terminal');
    assert.deepEqual(calls, ['associate', 'release-terminal']);
});

test('legacy attempts without references remain reserved', async () => {
    let released = false;
    const result = await recoverPayment({
        state: 'legacy',
        reference: null,
        reservationToken: 'legacy-token',
        verify: async () => assert.fail('must not verify without reference'),
        associate: async () => {},
        complete: async () => {},
        releasePrepared: async () => { released = true; },
        releaseRejected: async () => { released = true; },
        releaseTerminal: async () => { released = true; }
    });

    assert.equal(result, 'missing-reference');
    assert.equal(released, false);
});
