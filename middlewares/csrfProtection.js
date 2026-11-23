'use strict';

const { csrfSync } = require('csrf-sync');

function getTokenFromRequest(req) {
    const headerToken = req.get('x-csrf-token');
    if (typeof headerToken === 'string') return headerToken;

    return typeof req.body?._csrf === 'string' ? req.body._csrf : undefined;
}

const {
    csrfSynchronisedProtection,
    generateToken,
    isRequestValid
} = csrfSync({
    getTokenFromRequest,
    skipCsrfProtection: req =>
        req.method === 'POST' &&
        req.originalUrl.split('?')[0] === '/checkout/webhook'
});

module.exports = {
    csrfSynchronisedProtection,
    generateToken,
    isRequestValid
};
