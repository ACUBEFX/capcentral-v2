'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');

test('product routes and active cart links target the existing catalog page', () => {
    const routes = fs.readFileSync(path.join(projectRoot, 'routes/serveroutes.js'), 'utf8');
    const catalog = path.join(projectRoot, 'public/index.html');

    assert.equal(fs.existsSync(catalog), true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'public/index1.html')), false);
    assert.match(routes, /router\.get\('\/products'.*public', 'index\.html'/);
    assert.match(routes, /router\.get\('\/caps'.*public', 'index\.html'/);

    for (const file of [
        'views/checkout.ejs',
        'views/profile.ejs',
        'views/partials/customer-account-nav.ejs',
        'views/login.ejs',
        'public/homepage.html',
        'public/index.html',
        'public/tonak.html'
    ]) {
        const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
        assert.doesNotMatch(source, /index1\.html/, `${file} should not link to the removed catalog filename`);
    }
});

test('service checkout initializes through the server and keeps an idempotency key after ambiguity', () => {
    const html = fs.readFileSync(path.join(projectRoot, 'public/services.html'), 'utf8');
    assert.match(html, /\/initialize-service-payment/);
    assert.match(html, /idempotencyKey/);
    assert.match(html, /attemptRecord\.unresolved = true/);
    assert.match(html, /Do not submit another payment/);
    assert.doesNotMatch(html, /PaystackPop\.setup|pk_(?:test|live)_/);

    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map(match => match[1])
        .filter(script => script.trim());
    for (const [index, script] of scripts.entries()) {
        assert.doesNotThrow(() => new vm.Script(script, { filename: `services-inline-${index}.js` }));
    }
});

function loadCsrfClient(fetchMock) {
    const handlers = {};
    class FakeForm {
        constructor() {
            this.dataset = {};
            this.method = 'POST';
            this.fields = {};
            this.submissions = 0;
        }

        querySelector(selector) {
            return selector === 'input[name="_csrf"]' ? this.fields._csrf || null : null;
        }

        appendChild(field) {
            this.fields[field.name] = field;
        }

        requestSubmit() {
            this.submissions += 1;
        }

        submit() {
            this.submissions += 1;
        }
    }

    const document = {
        readyState: 'loading',
        addEventListener(name, handler) {
            handlers[name] = handler;
        },
        createElement() {
            return { type: '', name: '', value: '' };
        }
    };
    const window = {
        location: { href: 'https://capcentral.test/checkout', origin: 'https://capcentral.test' },
        alert() {}
    };
    const context = {
        window,
        document,
        HTMLFormElement: FakeForm,
        fetch: fetchMock,
        URL,
        Headers
    };

    vm.runInNewContext(
        fs.readFileSync(path.join(projectRoot, 'public/csrf-client.js'), 'utf8'),
        context
    );
    return { window, handlers, FakeForm };
}

function response(status, body, headers = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Headers(headers),
        json: async () => body
    };
}

test('promo preview refreshes its token and retries one marked CSRF rejection', async () => {
    const requests = [];
    let tokenNumber = 0;
    let promoAttempts = 0;
    const client = loadCsrfClient(async (input, init = {}) => {
        requests.push({ url: String(input), init });
        if (String(input) === '/csrf-token') {
            tokenNumber += 1;
            return response(200, { csrfToken: `token-${tokenNumber}` });
        }
        promoAttempts += 1;
        if (promoAttempts === 1) {
            return response(403, null, { 'X-CSRF-Error': '1' });
        }
        return response(200, { valid: true });
    });

    const result = await client.window.capCentralCsrfFetch('/checkout/promo', {
        method: 'POST',
        body: 'promoCode=SAFE'
    }, { retryOnCsrf: true, idempotent: true });

    assert.equal(result.status, 200);
    assert.equal(promoAttempts, 2);
    assert.equal(requests.filter(item => item.url === '/csrf-token').length, 2);
    assert.equal(requests.filter(item => item.url === '/checkout/promo')[0].init.headers.get('X-CSRF-Token'), 'token-1');
    assert.equal(requests.filter(item => item.url === '/checkout/promo')[1].init.headers.get('X-CSRF-Token'), 'token-2');
});

test('a fresh page load requests a session-bound CSRF token', async () => {
    let tokenRequests = 0;
    const client = loadCsrfClient(async input => {
        assert.equal(String(input), '/csrf-token');
        tokenRequests += 1;
        return response(200, { csrfToken: 'page-token' });
    });

    await client.handlers.DOMContentLoaded();
    assert.equal(tokenRequests, 1);
});

test('payment verification does not retry a CSRF rejection', async () => {
    let verificationAttempts = 0;
    const client = loadCsrfClient(async input => {
        if (String(input) === '/csrf-token') return response(200, { csrfToken: 'fresh-token' });
        verificationAttempts += 1;
        return response(403, null, { 'X-CSRF-Error': '1' });
    });

    const result = await client.window.capCentralCsrfFetch('/verify-payment', {
        method: 'POST',
        body: '{}'
    });

    assert.equal(result.status, 403);
    assert.equal(verificationAttempts, 1);
});

test('form submission refreshes its token and suppresses duplicate submits while pending', async () => {
    let resolveToken;
    const client = loadCsrfClient(() => new Promise(resolve => { resolveToken = resolve; }));
    const form = new client.FakeForm();
    form.fields._csrf = { name: '_csrf', value: 'stale-token' };
    const firstEvent = {
        target: form,
        submitter: null,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
    };
    const firstSubmit = client.handlers.submit(firstEvent);
    assert.equal(firstEvent.prevented, true);

    const duplicateEvent = {
        target: form,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
    };
    client.handlers.submit(duplicateEvent);
    assert.equal(duplicateEvent.prevented, true);
    assert.equal(form.submissions, 0);

    resolveToken(response(200, { csrfToken: 'new-session-token' }));
    await firstSubmit;
    assert.equal(form.fields._csrf.value, 'new-session-token');
    assert.equal(form.submissions, 1);

    const resubmittedEvent = {
        target: form,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
    };
    client.handlers.submit(resubmittedEvent);
    assert.equal(resubmittedEvent.prevented, undefined);

    const repeatedEvent = {
        target: form,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
    };
    client.handlers.submit(repeatedEvent);
    assert.equal(repeatedEvent.prevented, true);
    assert.equal(form.submissions, 1);
});
