const db = require('../models/database');
const paystackService = require('./paystackService');
const { recoverPayment } = require('./paymentRecovery');
const { STALE_RECEIPT_MINUTES } = require('./receiptDelivery');
const servicePaymentService = require('./servicePaymentService');
const { withTransactionRetry } = require('./mysqlTransactionRetry');

const CHECK_INTERVAL_MS = 60 * 1000;
const EXPIRY_GRACE_MINUTES = 2;
const BATCH_SIZE = 50;

let timer = null;
let isRunning = false;

// =====================================================
// PARSE PAYSTACK METADATA
// =====================================================

function parseMetadata(value) {
    if (!value) return {};

    if (typeof value === 'object') {
        return value;
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);

            return parsed && typeof parsed === 'object'
                ? parsed
                : {};
        } catch (error) {
            return {};
        }
    }

    return {};
}

// =====================================================
// MARK VERIFIED SUCCESSFUL PAYMENT AS PAID
// =====================================================

async function preserveSuccessfulPaymentOnce(token, reference) {
    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [reservations] = await connection.execute(
            `SELECT id, status, paystack_reference
             FROM inventory_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [token]
        );

        if (!reservations.length) {
            throw new Error(
                `No reservations found for successful payment: ${token}`
            );
        }

        const allAlreadyPaid = reservations.every(
            row =>
                row.status === 'paid' &&
                row.paystack_reference === reference
        );

        if (allAlreadyPaid) {
            await connection.commit();

            console.log(
                `Reservation already paid: ${reference}`
            );

            return;
        }

        const invalidRows = reservations.filter(
            row =>
                row.status !== 'reserved' ||
                row.paystack_reference !== reference
        );

        if (invalidRows.length) {
            throw new Error(
                `Successful payment has inconsistent reservation states. ` +
                `Manual reconciliation required. Token: ${token}`
            );
        }

        const [updated] = await connection.execute(
            `UPDATE inventory_reservations
             SET status = 'paid'
             WHERE reservation_token = ?
               AND paystack_reference = ?
               AND status = 'reserved'`,
            [token, reference]
        );

        if (updated.affectedRows !== reservations.length) {
            throw new Error(
                `Could not preserve all successful payment reservations: ${token}`
            );
        }

        await connection.commit();

        console.log(
            `Preserved stock for successful Paystack payment: ${reference}`
        );
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

function preserveSuccessfulPayment(token, reference) {
    return withTransactionRetry(() => preserveSuccessfulPaymentOnce(token, reference));
}

// =====================================================
// PROCESS ONE EXPIRED RESERVATION TOKEN
// =====================================================

async function processReservation(token) {
    const [attemptRows] = await db.promise().execute(
        `SELECT reservation_token, paystack_reference,
                initialization_status, expected_amount, currency
         FROM payment_initialization_attempts
         WHERE reservation_token = ?`,
        [token]
    );

    const attempt = attemptRows[0] || null;
    let reference = attempt?.paystack_reference || null;
    let state = attempt?.initialization_status || 'legacy';

    if (!attempt) {
        const [reservations] = await db.promise().execute(
            `SELECT status, paystack_reference
             FROM inventory_reservations
             WHERE reservation_token = ?
               AND (
                   (status = 'reserved' AND expires_at <= DATE_SUB(
                       NOW(), INTERVAL ? MINUTE
                   ))
                   OR status = 'paid'
               )`,
            [token, EXPIRY_GRACE_MINUTES]
        );

        if (!reservations.length) return;

        const references = [...new Set(
            reservations.map(row => row.paystack_reference || null)
        )];

        if (references.length !== 1) {
            console.error(`Inconsistent legacy payment references: ${token}`);
            return;
        }

        reference = references[0];

        if (!reference) {
            console.warn(`Legacy reservation has no reference; leaving reserved for reconciliation: ${token}`);
            return;
        }
    }

    const checkoutController = require('../controllers/checkoutController');
    const result = await recoverPayment({
        state,
        reference,
        reservationToken: token,
        verify: async reference => {
            const paymentData = await paystackService.verifyTransaction(reference);
            return paymentData
                ? { ...paymentData, metadata: parseMetadata(paymentData.metadata) }
                : paymentData;
        },
        associate: (paymentData, expectedReference, expectedToken) =>
            checkoutController.associateVerifiedPayment(
                paymentData,
                expectedReference,
                { ...parseMetadata(paymentData.metadata), reservationToken: expectedToken },
                { allowTerminalFailure: true }
            ),
        complete: async (paymentData, reservationToken) => {
            const metadata = parseMetadata(paymentData.metadata);
            await preserveSuccessfulPayment(reservationToken, paymentData.reference);
            await checkoutController.processVerifiedSuccessfulPayment(paymentData, metadata);
        },
        releasePrepared: () =>
            checkoutController.releaseReservationForRecovery(token, reference, 'prepared'),
        releaseRejected: () =>
            checkoutController.releaseReservationForRecovery(token, reference, 'rejected'),
        releaseTerminal: () =>
            checkoutController.releaseReservationForRecovery(token, reference, 'verified')
    });

    if ([
        'unverifiable',
        'verification-mismatch',
        'pending',
        'missing-reference',
        'missing-reservation-token'
    ].includes(result)) {
        console.log(`Reservation remains active (${result}): ${reference || token}`);
    }
}

// =====================================================
// RUN EXPIRY CHECK
// =====================================================

async function runExpiryCheck() {
    if (isRunning) return;

    isRunning = true;

    try {
        const [candidates] = await db.promise().execute(
            `SELECT ir.reservation_token
             FROM inventory_reservations ir
             LEFT JOIN payment_initialization_attempts a
               ON a.reservation_token = ir.reservation_token
             LEFT JOIN orders o
               ON o.order_reference = ir.paystack_reference
             LEFT JOIN payments p
               ON p.paystack_reference = ir.paystack_reference
             LEFT JOIN promo_usage_reservations pur
               ON pur.reservation_token = ir.reservation_token
             LEFT JOIN capcentral_receipt_emails re
               ON re.reference = ir.paystack_reference
             WHERE (
                (
                    ir.status = 'reserved'
                    AND ir.expires_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
                    AND (a.reservation_token IS NOT NULL OR ir.paystack_reference IS NOT NULL)
                )
                OR (
                    ir.status = 'expired'
                    AND a.reservation_token IS NOT NULL
                    AND a.initialization_status IN ('in_flight', 'initialized')
                    AND ir.paystack_reference IS NOT NULL
                )
                OR (
                    ir.status = 'paid'
                     AND ir.paystack_reference IS NOT NULL
                     AND (
                         o.id IS NULL
                         OR p.id IS NULL
                         OR pur.status = 'reserved'
                         OR re.reference IS NULL
                         OR (
                             re.status IN ('failed', 'sending')
                             AND re.updated_at <= DATE_SUB(
                                 NOW(), INTERVAL ${STALE_RECEIPT_MINUTES} MINUTE
                             )
                         )
                     )
                 )
             )
             GROUP BY ir.reservation_token
             ORDER BY MIN(ir.expires_at) ASC
             LIMIT ${BATCH_SIZE}`,
            [EXPIRY_GRACE_MINUTES]
        );

        for (const candidate of candidates) {
            try {
                await processReservation(
                    candidate.reservation_token
                );
            } catch (error) {
                console.error(
                    `Reservation expiry error (${candidate.reservation_token}):`,
                    error.message
                );
            }
        }

        await servicePaymentService.recoverStalePayments({
            onSuccess: reference =>
                require('../controllers/paystackController').deliverServiceReceipt(reference)
        });
    } catch (error) {
        console.error(
            'Reservation expiry worker failed:',
            error.message
        );
    } finally {
        isRunning = false;
    }
}

// =====================================================
// START EXPIRY WORKER
// =====================================================

exports.start = function () {
    if (timer) return;

    console.log('Reservation expiry service started.');

    runExpiryCheck();

    timer = setInterval(
        runExpiryCheck,
        CHECK_INTERVAL_MS
    );

    if (typeof timer.unref === 'function') {
        timer.unref();
    }
};

exports.runExpiryCheck = runExpiryCheck;
