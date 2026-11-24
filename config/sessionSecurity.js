'use strict';

const MIN_PRODUCTION_SECRET_LENGTH = 32;
const MIN_DISTINCT_SECRET_CHARACTERS = 16;

function createSessionSecurity(env = process.env) {
    const isRailway = Boolean(env.RAILWAY_ENVIRONMENT_NAME);
    const isRender = Boolean(env.RENDER) || Boolean(env.RENDER_SERVICE_ID);
    const isProduction = env.NODE_ENV === 'production' || isRailway || isRender;
    const secret = env.SESSION_SECRET;

    if (isProduction) {
        const validSecret = typeof secret === 'string' &&
            secret.length >= MIN_PRODUCTION_SECRET_LENGTH &&
            new Set(secret).size >= MIN_DISTINCT_SECRET_CHARACTERS;

        if (!validSecret) {
            throw new Error(
                'Production startup requires a strong SESSION_SECRET ' +
                '(at least 32 characters with at least 16 distinct characters).'
            );
        }
    }

    return {
        secret,
        secureCookie: isProduction,
        trustProxy: (isRailway || isRender) ? 1 : false
    };
}

module.exports = { createSessionSecurity };
