'use strict';

const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

function isRetryableTransactionError(error) {
    return RETRYABLE_CODES.has(error?.code) || Number(error?.errno) === 1213 || Number(error?.errno) === 1205;
}

async function withTransactionRetry(operation, { attempts = 3, baseDelayMs = 20 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (!isRetryableTransactionError(error) || attempt >= attempts) throw error;
            const jitter = Math.floor(Math.random() * baseDelayMs);
            await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt + jitter));
        }
    }
}

module.exports = { isRetryableTransactionError, withTransactionRetry };
