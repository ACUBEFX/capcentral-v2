'use strict';

const crypto = require('node:crypto');
const db = require('../models/database');
const paystackService = require('./paystackService');
const { saveCapService } = require('../models/services');
const { withTransactionRetry } = require('./mysqlTransactionRetry');
const { normalizeServicePaymentInput, validateVerifiedServicePayment } = require('./servicePaymentValidation');
const { STALE_RECEIPT_MINUTES } = require('./receiptDelivery');

const RECOVERY_GRACE_MINUTES = 2;

function parseDetails(value) {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(String(value || '')); } catch { return null; }
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

function publicAttempt(row) {
    if (!row) return null;
    return {
        reference: row.reference,
        idempotency_key: row.idempotency_key,
        service_type: row.service_type,
        payer_email: row.payer_email,
        expected_amount: Number(row.expected_amount),
        currency: row.currency,
        service_details: parseDetails(row.service_details),
        initialization_status: row.initialization_status,
        authorization_url: row.authorization_url || null
    };
}

function validateIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
        throw new Error('A valid service payment idempotency key is required.');
    }
    return key;
}

async function getByReference(reference, database = db.promise()) {
    const [rows] = await database.execute(
        `SELECT reference, idempotency_key, service_type, payer_email,
                expected_amount, currency, service_details,
                initialization_status, authorization_url
         FROM service_payment_attempts WHERE reference = ?`,
        [String(reference || '').trim()]
    );
    return publicAttempt(rows[0]);
}

async function getByIdempotencyKey(key, database = db.promise()) {
    const [rows] = await database.execute(
        `SELECT reference, idempotency_key, service_type, payer_email,
                expected_amount, currency, service_details,
                initialization_status, authorization_url
         FROM service_payment_attempts WHERE idempotency_key = ?`,
        [key]
    );
    return publicAttempt(rows[0]);
}

async function createOrGetAttempt({ idempotencyKey, serviceType, formData }, database = db.promise()) {
    const key = validateIdempotencyKey(idempotencyKey);
    const normalized = normalizeServicePaymentInput(serviceType, formData);
    const details = normalized.formData;
    const reference = `CCS-${crypto.randomUUID()}`;
    const connection = await database.getConnection();

    try {
        await connection.beginTransaction();
        await connection.execute(
            `INSERT INTO service_payment_attempts
                (reference, idempotency_key, service_type, payer_email,
                 expected_amount, currency, service_details, initialization_status)
             VALUES (?, ?, ?, ?, ?, 'NGN', ?, 'prepared')`,
            [reference, key, normalized.serviceType, details.email,
                normalized.expectedAmountInKobo, JSON.stringify(details)]
        );
        await connection.commit();
        return {
            attempt: {
                reference, idempotency_key: key,
                service_type: normalized.serviceType,
                payer_email: details.email,
                expected_amount: normalized.expectedAmountInKobo,
                currency: 'NGN', service_details: details,
                initialization_status: 'prepared', authorization_url: null
            },
            created: true
        };
    } catch (error) {
        await connection.rollback();
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const existing = await getByIdempotencyKey(key, database);
        if (!existing) throw error;
        const sameRequest = existing.service_type === normalized.serviceType &&
            existing.payer_email.toLowerCase() === details.email.toLowerCase() &&
            existing.expected_amount === normalized.expectedAmountInKobo &&
            JSON.stringify(canonical(existing.service_details)) === JSON.stringify(canonical(details));
        if (!sameRequest) throw new Error('This idempotency key was already used for different service details.');
        return { attempt: existing, created: false };
    } finally {
        connection.release();
    }
}

async function startInitialization(reference, initialize, database = db.promise()) {
    const [claimed] = await database.execute(
        `UPDATE service_payment_attempts
         SET initialization_status = 'in_flight', updated_at = NOW()
         WHERE reference = ? AND initialization_status = 'prepared'`,
        [reference]
    );
    if (claimed.affectedRows !== 1) {
        const current = await getByReference(reference, database);
        if (current?.initialization_status === 'initialized' && current.authorization_url) return current;
        if (current?.initialization_status === 'in_flight') return current;
        throw new Error('Service payment attempt is not eligible for initialization.');
    }

    const attempt = await getByReference(reference, database);
    let response;
    try {
        response = await initialize(attempt);
    } catch (error) {
        const status = Number(error.response?.status);
        if ((error.definitiveInitializationRejection || [400, 401, 403, 422].includes(status)) &&
            error.response?.data?.status === false) {
            await database.execute(
                `UPDATE service_payment_attempts
                 SET initialization_status = 'rejected', rejection_detail = ?, updated_at = NOW()
                 WHERE reference = ? AND initialization_status = 'in_flight'`,
                [String(error.response?.data?.message || error.message).slice(0, 1000), reference]
            );
        }
        throw error;
    }

    if (String(response?.reference || '') !== reference ||
        typeof response?.authorization_url !== 'string' || !response.authorization_url) {
        throw new Error('Paystack returned an incomplete or mismatched service payment initialization.');
    }

    const [updated] = await database.execute(
        `UPDATE service_payment_attempts
         SET initialization_status = 'initialized', authorization_url = ?, updated_at = NOW()
         WHERE reference = ? AND initialization_status = 'in_flight'`,
        [response.authorization_url, reference]
    );
    if (updated.affectedRows !== 1) throw new Error('Could not persist service payment initialization.');
    return getByReference(reference, database);
}

async function processVerifiedPaymentOnce(reference, transaction, database = db.promise()) {
    const connection = await database.getConnection();
    let result;
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT reference, idempotency_key, service_type, payer_email,
                    expected_amount, currency, service_details, initialization_status
             FROM service_payment_attempts WHERE reference = ? FOR UPDATE`,
            [reference]
        );
        if (rows.length !== 1) throw new Error('Service payment attempt was not found.');
        const attempt = publicAttempt(rows[0]);
        const details = attempt.service_details;
        validateVerifiedServicePayment(transaction, attempt);

        const status = String(transaction.status || '').toLowerCase();
        if (status === 'success') {
            if (attempt.initialization_status === 'rejected' || attempt.initialization_status === 'failed') {
                throw new Error('Successful Paystack payment conflicts with a terminal service attempt.');
            }
            await saveCapService({
                reference,
                serviceType: attempt.service_type,
                formData: details
            }, database, connection);
            await connection.execute(
                `UPDATE service_payment_attempts
                 SET initialization_status = 'paid', paystack_transaction_id = ?, updated_at = NOW()
                 WHERE reference = ? AND initialization_status <> 'paid'`,
                [transaction.id == null ? null : String(transaction.id), reference]
            );
            result = { status: 'success', reference, serviceType: attempt.service_type };
        } else if (status === 'failed' || status === 'abandoned') {
            if (attempt.initialization_status !== 'paid') {
                await connection.execute(
                    `UPDATE service_payment_attempts
                     SET initialization_status = 'failed', updated_at = NOW()
                     WHERE reference = ? AND initialization_status IN ('in_flight','initialized','failed')`,
                    [reference]
                );
            }
            result = { status, reference };
        } else {
            await connection.execute(
                `UPDATE service_payment_attempts SET updated_at = NOW()
                 WHERE reference = ? AND initialization_status IN ('in_flight','initialized')`,
                [reference]
            );
            result = { status: 'pending', reference };
        }
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

function processVerifiedPayment(reference, transaction, database = db.promise()) {
    return withTransactionRetry(() =>
        processVerifiedPaymentOnce(reference, transaction, database)
    );
}

async function recoverStalePayments({ onSuccess, limit = 25, database = db.promise() } = {}) {
    const [rows] = await database.execute(
        `SELECT reference, initialization_status
         FROM service_payment_attempts
         WHERE (
             initialization_status IN ('in_flight','initialized')
             AND updated_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
         ) OR (
             initialization_status = 'paid'
             AND updated_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
             AND NOT EXISTS (
                 SELECT 1 FROM capcentral_receipt_emails r
                 WHERE r.reference = service_payment_attempts.reference
                   AND (
                       r.status = 'sent'
                       OR (r.status = 'sending' AND r.updated_at >
                           DATE_SUB(NOW(), INTERVAL ${STALE_RECEIPT_MINUTES} MINUTE))
                       OR (r.status = 'failed' AND r.updated_at >
                           DATE_SUB(NOW(), INTERVAL ${RECOVERY_GRACE_MINUTES} MINUTE))
                   )
             )
         )
         ORDER BY updated_at ASC LIMIT ${Math.trunc(Math.max(1, Math.min(Number(limit) || 25, 100)))}`,
        [RECOVERY_GRACE_MINUTES, RECOVERY_GRACE_MINUTES]
    );

    const results = [];
    for (const row of rows) {
        try {
            const transaction = await paystackService.verifyTransaction(row.reference);
            const processed = await processVerifiedPayment(row.reference, transaction, database);
            if (processed.status === 'success' && onSuccess) await onSuccess(row.reference, transaction);
            results.push(processed.status);
        } catch (error) {
            // Verification errors and mismatches are ambiguous; retain the attempt for a later pass.
            if (row.initialization_status !== 'paid') {
                await database.execute(
                    `UPDATE service_payment_attempts SET updated_at = NOW()
                     WHERE reference = ? AND initialization_status IN ('in_flight','initialized')`,
                    [row.reference]
                ).catch(() => {});
            } else {
                await database.execute(
                    `UPDATE service_payment_attempts SET updated_at = NOW()
                     WHERE reference = ? AND initialization_status = 'paid'`,
                    [row.reference]
                ).catch(() => {});
                await database.execute(
                    `UPDATE capcentral_receipt_emails SET updated_at = NOW()
                     WHERE reference = ? AND status = 'failed'`,
                    [row.reference]
                ).catch(() => {});
            }
            results.push('unverifiable');
        }
    }
    return results;
}

module.exports = {
    RECOVERY_GRACE_MINUTES,
    createOrGetAttempt,
    getByReference,
    processVerifiedPayment,
    recoverStalePayments,
    startInitialization
};
