const db = require('../models/database');

function normalizePromoCode(code) {
    return String(code || '').trim().toUpperCase();
}

function calculateDiscountInKobo(promo, subtotalInKobo) {
    const valueInKobo = Math.round(
        Number(promo.discount_value) * 100
    );

    if (!Number.isSafeInteger(valueInKobo) || valueInKobo <= 0) {
        throw new Error('Invalid promotion discount value.');
    }

    let discountInKobo;

    if (promo.discount_type === 'percentage') {
        discountInKobo = Math.round(
            subtotalInKobo * Number(promo.discount_value) / 100
        );
    } else if (promo.discount_type === 'fixed') {
        discountInKobo = valueInKobo;
    } else {
        throw new Error('Unsupported promotion discount type.');
    }

    if (promo.max_discount !== null &&
        promo.max_discount !== undefined) {
        const maximumInKobo = Math.round(
            Number(promo.max_discount) * 100
        );

        discountInKobo = Math.min(
            discountInKobo,
            maximumInKobo
        );
    }

    return Math.min(
        Math.max(0, discountInKobo),
        subtotalInKobo
    );
}

async function validatePromoCode(
    code,
    subtotalInKobo,
    connection = db.promise(),
    lock = false
) {
    const normalizedCode = normalizePromoCode(code);

    if (!normalizedCode) {
        throw new Error('Please enter a promotion code.');
    }

    if (!Number.isSafeInteger(subtotalInKobo) || subtotalInKobo <= 0) {
        throw new Error('Invalid order subtotal.');
    }

    const [rows] = await connection.execute(
        `SELECT *,
                (starts_at IS NULL OR starts_at <= NOW()) AS has_started,
                (expires_at IS NULL OR expires_at >= NOW()) AS not_expired
         FROM promo_codes
         WHERE code = ?
         LIMIT 1
         ${lock ? 'FOR UPDATE' : ''}`,
        [normalizedCode]
    );

    if (!rows.length) {
        throw new Error('This promotion code does not exist.');
    }

    const promo = rows[0];

    if (Number(promo.is_active) !== 1) {
        throw new Error('This promotion code is inactive.');
    }

    if (Number(promo.has_started) !== 1) {
        throw new Error('This promotion code is not active yet.');
    }

    if (Number(promo.not_expired) !== 1) {
        throw new Error('This promotion code has expired.');
    }

    if (promo.usage_limit !== null &&
        Number(promo.usage_count) >= Number(promo.usage_limit)) {
        throw new Error('This promotion code has reached its usage limit.');
    }

    const minimumInKobo = Math.round(
        Number(promo.min_order_amount) * 100
    );

    if (subtotalInKobo < minimumInKobo) {
        throw new Error(
            `Minimum order amount for this code is NGN ${Number(promo.min_order_amount).toLocaleString()}.`
        );
    }

    const discountInKobo = calculateDiscountInKobo(
        promo,
        subtotalInKobo
    );

    if (discountInKobo <= 0) {
        throw new Error('This promotion does not apply to your order.');
    }

    return {
        id: Number(promo.id),
        code: promo.code,
        discountInKobo,
        discountAmount: discountInKobo / 100
    };
}

async function reservePromoUsage(
    code,
    subtotalInKobo,
    reservationToken,
    sharedConnection = null,
    paystackReference = null
) {
    const ownsConnection = !sharedConnection;
    const connection = sharedConnection || await db.promise().getConnection();

    try {
        if (ownsConnection) await connection.beginTransaction();

        const promo = await validatePromoCode(
            code,
            subtotalInKobo,
            connection,
            true
        );

        const [promoRows] = await connection.execute(
            `SELECT usage_limit, usage_count
             FROM promo_codes
             WHERE id = ?
             FOR UPDATE`,
            [promo.id]
        );

        if (!promoRows.length) {
            throw new Error('Promotion code no longer exists.');
        }

        const [reservationRows] = await connection.execute(
            `SELECT COUNT(*) AS reserved_count
             FROM promo_usage_reservations
             WHERE promo_code_id = ?
               AND status = 'reserved'`,
            [promo.id]
        );

        const usageLimit = promoRows[0].usage_limit;
        const currentUsage = Number(promoRows[0].usage_count);
        const reservedCount = Number(
            reservationRows[0].reserved_count
        );

        if (
            usageLimit !== null &&
            currentUsage + reservedCount >= Number(usageLimit)
        ) {
            throw new Error(
                'This promotion code has reached its usage limit.'
            );
        }

        await connection.execute(
            `INSERT INTO promo_usage_reservations
                (promo_code_id, reservation_token, paystack_reference,
                 status, expires_at)
             VALUES (?, ?, ?, 'reserved', DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
            [promo.id, reservationToken, paystackReference]
        );

        if (ownsConnection) await connection.commit();

        return promo;
    } catch (error) {
        if (ownsConnection) await connection.rollback();
        throw error;
    } finally {
        if (ownsConnection) connection.release();
    }
}

async function linkPromoUsage(reservationToken, reference) {
    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT paystack_reference, status
             FROM promo_usage_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (!rows.length) {
            throw new Error('Promotion reservation was not found.');
        }

        const reservation = rows[0];

        if (reservation.status !== 'reserved') {
            throw new Error('Promotion reservation is no longer active.');
        }

        if (
            reservation.paystack_reference &&
            reservation.paystack_reference !== reference
        ) {
            throw new Error(
                'Promotion reservation is linked to another payment.'
            );
        }

        if (!reservation.paystack_reference) {
            await connection.execute(
                `UPDATE promo_usage_reservations
                 SET paystack_reference = ?
                 WHERE reservation_token = ?`,
                [reference, reservationToken]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function releasePromoUsage(reservationToken, reference = null) {
    if (!reservationToken) {
        return;
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT paystack_reference, status
             FROM promo_usage_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (!rows.length || rows[0].status !== 'reserved') {
            await connection.commit();
            return;
        }

        if (
            reference &&
            rows[0].paystack_reference &&
            rows[0].paystack_reference !== reference
        ) {
            throw new Error(
                'Cannot release a reservation linked to another payment.'
            );
        }

        await connection.execute(
            `UPDATE promo_usage_reservations
             SET status = 'released'
             WHERE reservation_token = ?`,
            [reservationToken]
        );

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}


async function redeemPromoUsage(
    connection,
    {
        reservationToken,
        reference,
        orderId,
        promoId,
        promoCode,
        discountInKobo,
        subtotalInKobo
    }
) {
    if (
        !connection ||
        !reservationToken ||
        !reference ||
        !Number.isSafeInteger(Number(orderId)) ||
        Number(orderId) <= 0 ||
        !Number.isSafeInteger(Number(promoId)) ||
        Number(promoId) <= 0 ||
        !Number.isSafeInteger(discountInKobo) ||
        discountInKobo <= 0 ||
        !Number.isSafeInteger(subtotalInKobo) ||
        subtotalInKobo <= 0 ||
        discountInKobo > subtotalInKobo
    ) {
        throw new Error('Invalid promotion redemption details.');
    }

    const [reservationRows] = await connection.execute(
        `SELECT promo_code_id, paystack_reference, status
         FROM promo_usage_reservations
         WHERE reservation_token = ?
         FOR UPDATE`,
        [reservationToken]
    );

    if (!reservationRows.length) {
        throw new Error('Promotion reservation was not found.');
    }

    const reservation = reservationRows[0];

    if (Number(reservation.promo_code_id) !== Number(promoId)) {
        throw new Error('Promotion reservation does not match the order.');
    }

    if (
        reservation.paystack_reference &&
        reservation.paystack_reference !== reference
    ) {
        throw new Error(
            'Promotion reservation belongs to another payment.'
        );
    }

    if (reservation.status === 'redeemed') {
        if (reservation.paystack_reference !== reference) {
            throw new Error(
                'Promotion was already redeemed for another payment.'
            );
        }

        const [redemptions] = await connection.execute(
            `SELECT promo_code_id, order_id, paystack_reference,
                    discount_amount
             FROM promo_redemptions
             WHERE order_id = ? OR paystack_reference = ?
             FOR UPDATE`,
            [orderId, reference]
        );

        const existing = redemptions[0];

        if (
            redemptions.length !== 1 ||
            Number(existing.promo_code_id) !== Number(promoId) ||
            Number(existing.order_id) !== Number(orderId) ||
            existing.paystack_reference !== reference ||
            Math.round(Number(existing.discount_amount) * 100) !==
                discountInKobo
        ) {
            throw new Error(
                'Existing promotion redemption does not match this payment.'
            );
        }

        return;
    }

    const [promoRows] = await connection.execute(
        `SELECT *
         FROM promo_codes
         WHERE id = ?
         FOR UPDATE`,
        [promoId]
    );

    if (promoRows.length !== 1) {
        throw new Error('Reserved promotion code no longer exists.');
    }

    // The offer was validated and its usage reserved before Paystack
    // initialization. Admin edits made while the customer paid must not
    // invalidate that already-priced, verified transaction.
    if (reservation.status !== 'reserved') {
        throw new Error('Promotion reservation is no longer active.');
    }

    await connection.execute(
        `INSERT INTO promo_redemptions
            (
                promo_code_id,
                order_id,
                paystack_reference,
                discount_amount
            )
         VALUES (?, ?, ?, ?)`,
        [
            promoId,
            orderId,
            reference,
            (discountInKobo / 100).toFixed(2)
        ]
    );

    await connection.execute(
        `UPDATE promo_codes
         SET usage_count = usage_count + 1
         WHERE id = ?`,
        [promoId]
    );

    await connection.execute(
        `UPDATE promo_usage_reservations
         SET status = 'redeemed',
             paystack_reference = ?
         WHERE reservation_token = ?`,
        [reference, reservationToken]
    );
}

module.exports = {
    normalizePromoCode,
    calculateDiscountInKobo,
    validatePromoCode,
    reservePromoUsage,
    linkPromoUsage,
    releasePromoUsage,
    redeemPromoUsage
};
