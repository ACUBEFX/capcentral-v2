const db = require('../models/database');
const paystackService = require('./paystackService');

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
// RESTORE STOCK AND MARK RESERVATION EXPIRED
// =====================================================

async function expireReservation(token, expectedReference = null) {
    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [reservations] = await connection.execute(
            `SELECT
                id,
                product_id,
                variant_id,
                quantity,
                paystack_reference
             FROM inventory_reservations
             WHERE reservation_token = ?
               AND status = 'reserved'
               AND expires_at <= DATE_SUB(
                   NOW(),
                   INTERVAL ? MINUTE
               )
             FOR UPDATE`,
            [token, EXPIRY_GRACE_MINUTES]
        );

        if (!reservations.length) {
            await connection.commit();
            return;
        }

        for (const reservation of reservations) {
            const currentReference =
                reservation.paystack_reference || null;

            if (currentReference !== expectedReference) {
                throw new Error(
                    `Payment reference changed during expiry: ${token}`
                );
            }
        }

        for (const reservation of reservations) {
            const [updated] = await connection.execute(
                `UPDATE inventory_reservations
                 SET status = 'expired'
                 WHERE id = ?
                   AND status = 'reserved'`,
                [reservation.id]
            );

            if (updated.affectedRows !== 1) {
                throw new Error(
                    `Could not expire reservation ${reservation.id}.`
                );
            }

            const [stockUpdate] = await connection.execute(
                reservation.variant_id
                    ? `UPDATE product_variants
                       SET stock_quantity = stock_quantity + ?
                       WHERE id = ? AND product_id = ?`
                    : `UPDATE products
                       SET stock_quantity = stock_quantity + ?
                       WHERE id = ?`,
                reservation.variant_id
                    ? [
                        reservation.quantity,
                        reservation.variant_id,
                        reservation.product_id
                    ]
                    : [
                        reservation.quantity,
                        reservation.product_id
                    ]
            );

            if (stockUpdate.affectedRows !== 1) {
                throw new Error(
                    `Could not restore stock for product ${reservation.product_id}.`
                );
            }
        }

        await connection.commit();

        console.log(
            `Expired reservation and restored stock: ${token}`
        );
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// =====================================================
// MARK VERIFIED SUCCESSFUL PAYMENT AS PAID
// =====================================================

async function preserveSuccessfulPayment(token, reference) {
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

// =====================================================
// PROCESS ONE EXPIRED RESERVATION TOKEN
// =====================================================

async function processReservation(token) {
    const [reservations] = await db.promise().execute(
        `SELECT paystack_reference
         FROM inventory_reservations
         WHERE reservation_token = ?
           AND status = 'reserved'
           AND expires_at <= DATE_SUB(
               NOW(),
               INTERVAL ? MINUTE
           )`,
        [token, EXPIRY_GRACE_MINUTES]
    );

    if (!reservations.length) return;

    const references = reservations.map(
        row => row.paystack_reference || null
    );

    const uniqueReferences = [...new Set(references)];

    if (uniqueReferences.length !== 1) {
        console.error(
            `Inconsistent payment references for reservation: ${token}`
        );
        return;
    }

    const reference = uniqueReferences[0];

    // No payment was initialized or linked.
    if (!reference) {
        await expireReservation(token, null);
        return;
    }

    let paymentData;

    // Never release stock if Paystack verification fails.
    try {
        paymentData =
            await paystackService.verifyTransaction(reference);
    } catch (error) {
        console.warn(
            `Paystack verification failed for ${reference}:`,
            error.message
        );
        return;
    }

    if (
        !paymentData ||
        String(paymentData.reference || '') !== reference
    ) {
        console.warn(
            `Invalid Paystack verification response: ${reference}`
        );
        return;
    }

    const metadata = parseMetadata(paymentData.metadata);

    if (
        String(metadata.reservationToken || '').trim() !== token
    ) {
        console.error(
            `Paystack reservation token mismatch: ${reference}`
        );
        return;
    }

    // Successful payment: never restore stock.
    if (paymentData.status === 'success') {
        await preserveSuccessfulPayment(token, reference);
        return;
    }

    // Only terminal unsuccessful statuses release stock.
    if (
        paymentData.status === 'failed' ||
        paymentData.status === 'abandoned'
    ) {
        await expireReservation(token, reference);
        return;
    }

    // Pending or unknown status: leave stock reserved.
    console.log(
        `Reservation remains active; Paystack status is ${paymentData.status}: ${reference}`
    );
}

// =====================================================
// RUN EXPIRY CHECK
// =====================================================

async function runExpiryCheck() {
    if (isRunning) return;

    isRunning = true;

    try {
        const [candidates] = await db.promise().execute(
            `SELECT reservation_token
             FROM inventory_reservations
             WHERE status = 'reserved'
               AND expires_at <= DATE_SUB(
                   NOW(),
                   INTERVAL ? MINUTE
               )
             GROUP BY reservation_token
             ORDER BY MIN(expires_at) ASC
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
