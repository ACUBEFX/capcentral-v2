'use strict';

(() => {
    async function getCsrfToken() {
        const response = await fetch('/csrf-token', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Could not obtain a security token.');

        const data = await response.json();
        if (typeof data.csrfToken !== 'string' || !data.csrfToken) {
            throw new Error('Could not obtain a security token.');
        }
        return data.csrfToken;
    }

    // Bootstrap a token for every fresh page/session, including after login
    // regenerated the session. Unsafe actions still fetch a current token.
    const bootstrapCsrfToken = () => getCsrfToken().catch(() => {});
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapCsrfToken, { once: true });
    } else {
        bootstrapCsrfToken();
    }

    window.capCentralCsrfToken = getCsrfToken;

    window.capCentralCsrfFetch = async (input, init = {}, options = {}) => {
        const url = new URL(input, window.location.href);
        if (url.origin !== window.location.origin) {
            throw new Error('CSRF tokens may only be sent to this site.');
        }

        const method = String(init.method || 'GET').toUpperCase();
        const canRetry = options.retryOnCsrf === true &&
            options.idempotent === true &&
            method === 'POST' &&
            url.pathname === '/checkout/promo';

        const sendWithFreshToken = async () => {
            const headers = new Headers(init.headers || {});
            headers.set('X-CSRF-Token', await getCsrfToken());
            return fetch(input, { ...init, headers, credentials: 'same-origin' });
        };

        let response = await sendWithFreshToken();
        if (
            canRetry &&
            response.status === 403 &&
            response.headers.get('X-CSRF-Error') === '1'
        ) {
            response = await sendWithFreshToken();
        }
        return response;
    };

    function setFormToken(form, token) {
        let field = form.querySelector('input[name="_csrf"]');
        if (!field) {
            field = document.createElement('input');
            field.type = 'hidden';
            field.name = '_csrf';
            form.appendChild(field);
        }
        field.value = token;
    }

    document.addEventListener('submit', async event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(form.method.toUpperCase())) return;
        if (form.dataset.csrfSubmitted === 'true') {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (form.dataset.csrfTokenReady === 'true') {
            delete form.dataset.csrfTokenReady;
            form.dataset.csrfSubmitted = 'true';
            return;
        }
        if (form.dataset.csrfTokenPending === 'true') {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        form.dataset.csrfTokenPending = 'true';
        try {
            setFormToken(form, await getCsrfToken());
            delete form.dataset.csrfTokenPending;
            form.dataset.csrfTokenReady = 'true';
            if (typeof form.requestSubmit === 'function') {
                form.requestSubmit(event.submitter || undefined);
            } else {
                form.submit();
            }
        } catch (_error) {
            delete form.dataset.csrfTokenPending;
            window.alert('Could not refresh the security token. Reload the page and try again.');
        }
    }, true);
})();
