
const crypto = require('crypto');
const paystackService = require('../services/paystackService');
const db = require('../models/database');
const promoService = require('../services/promoService');
const { initializeAttempt } = require('../services/paymentAttemptLifecycle');

const {
    sendProductPaymentConfirmationEmail
} = require('../utils/mailer');

// =====================================================
// GENERAL HELPERS
// =====================================================

function createReservationToken() {
    return crypto.randomUUID();
}

function createPaystackReference() {
    return `CC-${crypto.randomUUID()}`;
}

function getVariantId(item) {
    const value = item.variantId ?? item.variant_id;
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('Invalid product variant.');
    }

    return id;
}

function normalizeCart(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Error parsing cart:', error.message);
        }
    }

    return [];
}

function parsePaystackMetadata(value) {
    if (!value) return {};

    if (typeof value === 'object') return value;

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.error('Error parsing Paystack metadata:', error.message);
        }
    }

    return {};
}

function normalizeDeliveryOption(value) {
    const option = Array.isArray(value) ? value[0] : value;

    return String(option || 'standard').toLowerCase() === 'express'
        ? 'express'
        : 'standard';
}

function isCaps(product) {
    return String(product.category || '').trim().toLowerCase() === 'caps';
}

// =====================================================
// INVENTORY RESERVATION
// =====================================================

async function reserveInventory(
    reservationToken,
    cart,
    sharedConnection = null,
    paystackReference = null
) {
    if (!reservationToken || !Array.isArray(cart) || !cart.length) {
        throw new Error('Invalid inventory reservation request.');
    }

    const ownsConnection = !sharedConnection;
    const connection = sharedConnection || await db.promise().getConnection();

    try {
        if (ownsConnection) await connection.beginTransaction();

        const quantities = new Map();

        for (const item of cart) {
            const productId = Number(
                item.productId ?? item.product_id ?? item.id
            );

            const variantId = getVariantId(item);
            const quantity = Number(item.quantity ?? 1);

            if (
                !Number.isSafeInteger(productId) ||
                productId <= 0 ||
                !Number.isSafeInteger(quantity) ||
                quantity <= 0
            ) {
                throw new Error('Invalid product or quantity.');
            }

            const key = `${productId}:${variantId || 'product'}`;
            const previous = quantities.get(key);

            const combinedQuantity =
                (previous?.quantity || 0) + quantity;

            if (!Number.isSafeInteger(combinedQuantity)) {
                throw new Error('Invalid combined product quantity.');
            }

            quantities.set(key, {
                productId,
                variantId,
                quantity: combinedQuantity
            });
        }

        const entries = [...quantities.values()].sort(
            (a, b) =>
                a.productId - b.productId ||
                (a.variantId || 0) - (b.variantId || 0)
        );

        for (const entry of entries) {
            const { productId, variantId, quantity } = entry;

            const [products] = await connection.execute(
                `SELECT id, name, category, stock_quantity, is_active
                 FROM products
                 WHERE id = ?
                 FOR UPDATE`,
                [productId]
            );

            if (
                products.length !== 1 ||
                Number(products[0].is_active) !== 1
            ) {
                throw new Error(`Product ${productId} is unavailable.`);
            }

            const product = products[0];

            let stockTable = 'products';
            let stockId = productId;

            if (variantId !== null) {
                const [variants] = await connection.execute(
                    `SELECT id, product_id, size, stock_quantity
                     FROM product_variants
                     WHERE id = ? AND product_id = ?
                     FOR UPDATE`,
                    [variantId, productId]
                );

                if (variants.length !== 1) {
                    throw new Error(
                        `Selected variant for ${product.name} is unavailable.`
                    );
                }

                stockTable = 'product_variants';
                stockId = variantId;
            } else {
                const [variants] = await connection.execute(
                    `SELECT id
                     FROM product_variants
                     WHERE product_id = ?
                     LIMIT 1`,
                    [productId]
                );

                if (variants.length) {
                    throw new Error(
                        `Please select a size for ${product.name}.`
                    );
                }
            }

            if (isCaps(product) && quantity !== 1) {
                throw new Error(
                    `Caps are unique items: ${product.name}.`
                );
            }

            const [updated] = await connection.execute(
                stockTable === 'product_variants'
                    ? `UPDATE product_variants
                       SET stock_quantity = stock_quantity - ?
                       WHERE id = ? AND stock_quantity >= ?`
                    : `UPDATE products
                       SET stock_quantity = stock_quantity - ?
                       WHERE id = ?
                         AND is_active = 1
                         AND stock_quantity >= ?`,
                [quantity, stockId, quantity]
            );

            if (updated.affectedRows !== 1) {
                throw new Error(
                    `Insufficient stock for ${product.name}.`
                );
            }

            await connection.execute(
                `INSERT INTO inventory_reservations
                    (
                        reservation_token,
                        paystack_reference,
                        product_id,
                        variant_id,
                        quantity,
                        status,
                        expires_at
                    )
                 VALUES (
                    ?, ?, ?, ?, ?, 'reserved',
                    DATE_ADD(NOW(), INTERVAL 30 MINUTE)
                 )`,
                [reservationToken, paystackReference, productId, variantId, quantity]
            );
        }

        if (ownsConnection) await connection.commit();
        return true;
    } catch (error) {
        if (ownsConnection) await connection.rollback();
        throw error;
    } finally {
        if (ownsConnection) connection.release();
    }
}

// =====================================================
// RELEASE INVENTORY RESERVATION
// =====================================================

async function releaseReservation(
    reservationToken,
    expectedReference = null,
    options = {}
) {
    if (!reservationToken) return;

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [attemptRows] = await connection.execute(
            `SELECT reservation_token, paystack_reference,
                    initialization_status
             FROM payment_initialization_attempts
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        const attempt = attemptRows[0] || null;

        if (options.mode === 'prepared' &&
            attempt?.initialization_status !== 'prepared') {
            throw new Error('Payment attempt is no longer in the prepared state.');
        }

        if (options.mode === 'reject_and_release' &&
            attempt?.initialization_status !== 'in_flight') {
            throw new Error('Payment attempt is not awaiting a definitive initialization rejection.');
        }

        if (options.mode === 'rejected' &&
            attempt?.initialization_status !== 'rejected') {
            throw new Error('Payment attempt is not in the rejected state.');
        }

        if (options.mode === 'verified' && attempt &&
            !['in_flight', 'initialized'].includes(attempt.initialization_status)) {
            throw new Error('Payment attempt is not eligible for verified terminal release.');
        }

        if (attempt && expectedReference &&
            attempt.paystack_reference !== expectedReference) {
            throw new Error('Payment attempt reference does not match the reservation.');
        }

        const [reservations] = await connection.execute(
            `SELECT id, product_id, variant_id, quantity,
                    status, paystack_reference
             FROM inventory_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (reservations.some(row => row.status === 'paid')) {
            await connection.commit();
            console.warn(
                `Reservation release skipped because payment is already preserved: ${reservationToken}`
            );
            return;
        }

        if (options.mode === 'reject_and_release') {
            const [rejected] = await connection.execute(
                `UPDATE payment_initialization_attempts
                 SET initialization_status = 'rejected',
                     rejection_detail = ?
                 WHERE reservation_token = ?
                   AND initialization_status = 'in_flight'`,
                [String(options.rejectionDetail || 'Paystack rejected initialization').slice(0, 1000), reservationToken]
            );

            if (rejected.affectedRows !== 1) {
                throw new Error('Could not persist the definitive initialization rejection.');
            }
        } else if (options.mode === 'prepared') {
            // Prevent a delayed request handler from advancing this attempt to
            // in_flight after the expiry worker has released its reservations.
            const [cancelled] = await connection.execute(
                `UPDATE payment_initialization_attempts
                 SET initialization_status = 'rejected',
                     rejection_detail = 'Initialization was never started before reservation expiry.'
                 WHERE reservation_token = ?
                   AND initialization_status = 'prepared'`,
                [reservationToken]
            );

            if (cancelled.affectedRows !== 1) {
                throw new Error('Could not cancel the unstarted payment attempt.');
            }
        }

        if (expectedReference && reservations.some(
            row => row.paystack_reference &&
                row.paystack_reference !== expectedReference
        )) {
            throw new Error('Reservation is linked to another payment reference.');
        }

        for (const reservation of reservations) {
            if (reservation.status !== 'reserved') continue;

            const [updated] = await connection.execute(
                `UPDATE inventory_reservations
                 SET status = ?
                 WHERE id = ?
                   AND status = 'reserved'`,
                [options.expiry ? 'expired' : 'released', reservation.id]
            );

            if (updated.affectedRows !== 1) {
                throw new Error(
                    `Could not release reservation ${reservation.id}.`
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

        const [promoReservations] = await connection.execute(
            `SELECT status, paystack_reference
             FROM promo_usage_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (promoReservations.length && promoReservations[0].status === 'reserved') {
            const promoReference = promoReservations[0].paystack_reference || null;

            if (expectedReference && promoReference && promoReference !== expectedReference) {
                throw new Error('Promotion reservation is linked to another payment reference.');
            }

            await connection.execute(
                `UPDATE promo_usage_reservations
                 SET status = 'released'
                 WHERE reservation_token = ?
                   AND status = 'reserved'`,
                [reservationToken]
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

async function markPaymentAttemptInFlight(reservationToken, reference) {
    const [updated] = await db.promise().execute(
        `UPDATE payment_initialization_attempts
         SET initialization_status = 'in_flight'
         WHERE reservation_token = ?
           AND paystack_reference = ?
           AND initialization_status = 'prepared'`,
        [reservationToken, reference]
    );

    if (updated.affectedRows === 1) return;

    const [rows] = await db.promise().execute(
        `SELECT initialization_status, paystack_reference
         FROM payment_initialization_attempts
         WHERE reservation_token = ?`,
        [reservationToken]
    );

    if (
        rows.length !== 1 ||
        rows[0].paystack_reference !== reference ||
        rows[0].initialization_status !== 'in_flight'
    ) {
        throw new Error('Could not persist the payment attempt before Paystack initialization.');
    }
}

async function markPaymentAttemptInitialized(reservationToken, reference) {
    const [updated] = await db.promise().execute(
        `UPDATE payment_initialization_attempts
         SET initialization_status = 'initialized'
         WHERE reservation_token = ?
           AND paystack_reference = ?
           AND initialization_status = 'in_flight'`,
        [reservationToken, reference]
    );

    if (updated.affectedRows === 1) return;

    const [rows] = await db.promise().execute(
        `SELECT initialization_status, paystack_reference
         FROM payment_initialization_attempts
         WHERE reservation_token = ?`,
        [reservationToken]
    );

    if (
        rows.length !== 1 ||
        rows[0].paystack_reference !== reference ||
        rows[0].initialization_status !== 'initialized'
    ) {
        throw new Error('Could not persist the initialized payment state.');
    }
}

exports.releaseReservationForRecovery = (reservationToken, reference, mode) =>
    releaseReservation(reservationToken, reference, {
        mode,
        expiry: true
    });

function isDefinitiveInitializationRejection(error) {
    const status = Number(error.response?.status);

    return [400, 401, 403, 422].includes(status) &&
        error.response?.data?.status === false;
}

async function associateVerifiedPayment(paymentData, expectedReference, metadata) {
    const reference = String(paymentData?.reference || '').trim();
    const reservationToken = String(metadata?.reservationToken || '').trim();
    const amount = Number(paymentData?.amount);
    const currency = String(paymentData?.currency || '').toUpperCase();

    if (!reference || reference !== expectedReference) {
        throw new Error('Verified Paystack reference does not match the requested reference.');
    }

    if (!reservationToken) {
        throw new Error('Verified Paystack metadata is missing the reservation token.');
    }

    if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== 'NGN') {
        throw new Error('Verified Paystack amount or currency is invalid.');
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [attemptRows] = await connection.execute(
            `SELECT paystack_reference, initialization_status,
                    expected_amount, currency
             FROM payment_initialization_attempts
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        const [reservations] = await connection.execute(
            `SELECT status, paystack_reference
             FROM inventory_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (!reservations.length) {
            throw new Error('No inventory reservation exists for the verified payment.');
        }

        if (reservations.some(row =>
            !['reserved', 'paid'].includes(row.status) ||
            (row.paystack_reference && row.paystack_reference !== reference)
        )) {
            throw new Error('Verified payment conflicts with inventory reservation state or reference.');
        }

        let attempt = attemptRows[0] || null;

        if (attempt) {
            if (attempt.paystack_reference !== reference) {
                throw new Error('Verified payment reference conflicts with the durable payment attempt.');
            }

            if (Number(attempt.expected_amount) !== amount ||
                String(attempt.currency).toUpperCase() !== currency) {
                throw new Error('Verified payment amount or currency conflicts with the durable payment attempt.');
            }

            if (attempt.initialization_status === 'rejected') {
                throw new Error('Verified payment conflicts with a rejected initialization attempt.');
            }
        } else {
            await connection.execute(
                `INSERT INTO payment_initialization_attempts
                    (reservation_token, paystack_reference,
                     initialization_status, expected_amount, currency)
                 VALUES (?, ?, 'initialized', ?, ?)`,
                [reservationToken, reference, amount, currency]
            );
        }

        const [promoRows] = await connection.execute(
            `SELECT status, paystack_reference
             FROM promo_usage_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (metadata.promoCode && !promoRows.length) {
            throw new Error('Verified payment is missing its promotion reservation.');
        }

        if (promoRows.length) {
            const promo = promoRows[0];

            if (!['reserved', 'redeemed'].includes(promo.status) ||
                (promo.paystack_reference && promo.paystack_reference !== reference)) {
                throw new Error('Verified payment conflicts with promotion reservation state or reference.');
            }

            if (!promo.paystack_reference) {
                await connection.execute(
                    `UPDATE promo_usage_reservations
                     SET paystack_reference = ?
                     WHERE reservation_token = ?
                       AND paystack_reference IS NULL`,
                    [reference, reservationToken]
                );
            }
        }

        if (reservations.some(row => !row.paystack_reference)) {
            await connection.execute(
                `UPDATE inventory_reservations
                 SET paystack_reference = ?
                 WHERE reservation_token = ?
                   AND paystack_reference IS NULL`,
                [reference, reservationToken]
            );
        }

        if (attempt) {
            await connection.execute(
                `UPDATE payment_initialization_attempts
                 SET initialization_status = 'initialized'
                 WHERE reservation_token = ?
                   AND paystack_reference = ?
                   AND initialization_status IN ('prepared', 'in_flight', 'initialized')`,
                [reservationToken, reference]
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

// =====================================================
// LEGACY STOCK DEDUCTION
// Used only when no reservation token exists.
// =====================================================

async function updatePurchasedProductStock(reference, cart) {
    if (!reference || !Array.isArray(cart) || !cart.length) {
        throw new Error(
            'Missing payment reference or valid cart.'
        );
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [claim] = await connection.execute(
            `INSERT IGNORE INTO processed_cap_payments (reference)
             VALUES (?)`,
            [reference]
        );

        if (claim.affectedRows === 0) {
            await connection.commit();
            console.log(`Stock already processed for ${reference}.`);
            return;
        }

        for (const item of cart) {
            const rawId = item.productId ?? item.product_id ?? item.id;
            const productId = Number(rawId);
            const code = item.productCode || item.product_code;
            const quantity = Number(item.quantity ?? 1);

            if (!Number.isSafeInteger(quantity) || quantity < 1) {
                throw new Error('Invalid purchased product quantity.');
            }

            let rows = [];

            if (
                rawId &&
                Number.isSafeInteger(productId) &&
                productId > 0
            ) {
                [rows] = await connection.execute(
                    `SELECT id, name, category, stock_quantity
                     FROM products
                     WHERE id = ?
                     FOR UPDATE`,
                    [productId]
                );
            } else if (code) {
                [rows] = await connection.execute(
                    `SELECT id, name, category, stock_quantity
                     FROM products
                     WHERE product_code = ?
                     FOR UPDATE`,
                    [String(code)]
                );
            } else if (item.name) {
                const category =
                    item.category ||
                    item.productCategory ||
                    item.product_category;

                if (category) {
                    [rows] = await connection.execute(
                        `SELECT id, name, category, stock_quantity
                         FROM products
                         WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
                           AND LOWER(category) = LOWER(?)
                         LIMIT 2
                         FOR UPDATE`,
                        [String(item.name), String(category)]
                    );
                } else {
                    [rows] = await connection.execute(
                        `SELECT id, name, category, stock_quantity
                         FROM products
                         WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
                         LIMIT 2
                         FOR UPDATE`,
                        [String(item.name)]
                    );
                }
            }

            if (rows.length !== 1) {
                throw new Error(
                    `Could not uniquely identify purchased product: ${
                        item.name || code || rawId || 'unknown'
                    }.`
                );
            }

            const product = rows[0];
            const variantId = getVariantId(item);

            if (isCaps(product) && quantity !== 1) {
                throw new Error(
                    `Caps are unique items: ${product.name}.`
                );
            }

            if (variantId !== null) {
                const [variants] = await connection.execute(
                    `SELECT id
                     FROM product_variants
                     WHERE id = ? AND product_id = ?
                     FOR UPDATE`,
                    [variantId, product.id]
                );

                if (variants.length !== 1) {
                    throw new Error(
                        `Invalid variant for ${product.name}.`
                    );
                }

                const [updated] = await connection.execute(
                    `UPDATE product_variants
                     SET stock_quantity = stock_quantity - ?
                     WHERE id = ?
                       AND stock_quantity >= ?`,
                    [quantity, variantId, quantity]
                );

                if (updated.affectedRows !== 1) {
                    throw new Error(
                        `Insufficient variant stock for ${product.name}.`
                    );
                }
            } else {
                const [variants] = await connection.execute(
                    `SELECT id
                     FROM product_variants
                     WHERE product_id = ?
                     LIMIT 1`,
                    [product.id]
                );

                if (variants.length) {
                    throw new Error(
                        `Please select a size for ${product.name}.`
                    );
                }

                const [updated] = await connection.execute(
                    `UPDATE products
                     SET stock_quantity = stock_quantity - ?
                     WHERE id = ?
                       AND stock_quantity >= ?`,
                    [quantity, product.id, quantity]
                );

                if (updated.affectedRows !== 1) {
                    throw new Error(
                        `Insufficient stock for ${product.name}.`
                    );
                }
            }
        }

        await connection.commit();
        console.log(`Legacy stock deduction completed: ${reference}`);
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// =====================================================
// FINALIZE RESERVED PAYMENT
// Stock was already deducted during reservation.
// =====================================================

async function finalizeReservationPayment(reference, reservationToken) {
    if (!reference || !reservationToken) {
        throw new Error(
            'Missing payment reference or reservation token.'
        );
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [reservations] = await connection.execute(
            `SELECT id, status, paystack_reference
             FROM inventory_reservations
             WHERE reservation_token = ?
             FOR UPDATE`,
            [reservationToken]
        );

        if (!reservations.length) {
            throw new Error(
                `No inventory reservation found for payment ${reference}.`
            );
        }

        if (reservations.some(row => row.status !== 'reserved')) {
            // Allow an already-paid reservation to be processed again.
            if (reservations.every(
                row =>
                    row.status === 'paid' &&
                    row.paystack_reference === reference
            )) {
                await connection.commit();
                return;
            }

            throw new Error(
                `Reservation is not active for payment ${reference}.`
            );
        }

        if (
            reservations.some(
                row =>
                    row.paystack_reference &&
                    row.paystack_reference !== reference
            )
        ) {
            throw new Error(
                'Reservation is linked to a different payment reference.'
            );
        }

        await connection.execute(
            `UPDATE inventory_reservations
             SET status = 'paid',
                 paystack_reference = ?
             WHERE reservation_token = ?
               AND status = 'reserved'`,
            [reference, reservationToken]
        );

        await connection.commit();

        console.log(
            `Reservation finalized for payment: ${reference}`
        );
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function processVerifiedPaymentStock(paymentData, metadata, cart) {
    const reference = String(paymentData.reference || '').trim();
    const token = String(metadata.reservationToken || '').trim();

    if (token) {
        await finalizeReservationPayment(reference, token);
    } else {
        await updatePurchasedProductStock(reference, cart);
    }
}

// =====================================================
// SAVE VERIFIED ORDER
// =====================================================

async function savePaidOrder(paymentData, metadata = {}) {
    const reference = String(paymentData.reference || '').trim();

    if (!reference) {
        throw new Error(
            'Cannot save an order without a Paystack reference.'
        );
    }

    if (
        String(paymentData.status || '').toLowerCase() !== 'success'
    ) {
        throw new Error(
            'Cannot save an order for an unsuccessful payment.'
        );
    }

    const amount = Number(paymentData.amount) / 100;

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Invalid verified Paystack amount.');
    }

    const cart = normalizeCart(metadata.cart);

    if (!cart.length) {
        throw new Error(
            `Cannot save order ${reference}: cart is empty.`
        );
    }

    const surcharge = Math.max(
        0,
        Number(metadata.expressSurcharge) || 0
    );

    const promoCode = String(metadata.promoCode || '').trim().toUpperCase();
    const rawPromoId = Number(metadata.promoId);
    const promoId = Number.isSafeInteger(rawPromoId) && rawPromoId > 0
        ? rawPromoId
        : null;
    const rawPromoDiscountInKobo = Number(metadata.promoDiscountInKobo || 0);
    const reservationToken = String(metadata.reservationToken || '').trim();

    if (
        !Number.isSafeInteger(rawPromoDiscountInKobo) ||
        rawPromoDiscountInKobo < 0 ||
        (promoCode && (
            !promoId ||
            rawPromoDiscountInKobo <= 0 ||
            !reservationToken
        )) ||
        (!promoCode && (promoId || rawPromoDiscountInKobo !== 0))
    ) {
        throw new Error('Invalid promotion metadata.');
    }

    const rawUserId = Number(metadata.userId);

    const userId =
        Number.isInteger(rawUserId) && rawUserId > 0
            ? rawUserId
            : null;

    const deliveryOption =
        normalizeDeliveryOption(metadata.deliveryOption);

    const customerEmail = String(
        paymentData.customer?.email ||
        metadata.email ||
        ''
    ).trim();

    if (!customerEmail) {
        throw new Error(
            `Missing customer email for order ${reference}.`
        );
    }

    const customerName = String(
        metadata.customerName ||
        metadata.name ||
        [
            paymentData.customer?.first_name,
            paymentData.customer?.last_name
        ].filter(Boolean).join(' ') ||
        customerEmail.split('@')[0]
    ).trim().slice(0, 255);

    const customerPhone = String(
        metadata.customerPhone ||
        paymentData.customer?.phone ||
        ''
    ).trim().slice(0, 20) || null;

    const deliveryAddress = String(
        metadata.deliveryAddress || ''
    ).trim().slice(0, 2000) || null;

    const currency =
        String(paymentData.currency || 'NGN').toUpperCase();

    if (currency !== 'NGN') {
        throw new Error(
            `Unexpected payment currency: ${currency}.`
        );
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [existingOrders] = await connection.execute(
            `SELECT id
             FROM orders
             WHERE order_reference = ?
             FOR UPDATE`,
            [reference]
        );

        let orderId;

        if (existingOrders.length) {
            orderId = existingOrders[0].id;
        } else {
            const [orderResult] = await connection.execute(
                `INSERT INTO orders
                    (
                        order_reference,
                        user_id,
                        customer_name,
                        customer_email,
                        customer_phone,
                        subtotal,
                        delivery_fee,
                        express_surcharge,
                        total_amount,
                        currency,
                        order_status,
                        delivery_address,
                        delivery_option
                    )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', 'paid', ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
                [
                    reference,
                    userId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    0,
                    0,
                    surcharge,
                    amount,
                    deliveryAddress,
                    deliveryOption
                ]
            );

            orderId = orderResult.insertId;
        }

        const orderItems = [];
        let subtotalInKobo = 0;

        for (const item of cart) {
            const rawId =
                item.productId ??
                item.product_id ??
                item.id;

            const productId = Number(rawId);

            const productCode =
                item.productCode || item.product_code;

            const quantity = Number(item.quantity ?? 1);
            const variantId = getVariantId(item);

            if (!Number.isSafeInteger(quantity) || quantity < 1) {
                throw new Error(
                    `Invalid quantity in order ${reference}.`
                );
            }

            let rows;

            if (
                Number.isSafeInteger(productId) &&
                productId > 0
            ) {
                [rows] = await connection.execute(
                    `SELECT id, product_code, name, price, category, is_active
                     FROM products
                     WHERE id = ?
                     FOR UPDATE`,
                    [productId]
                );
            } else if (productCode) {
                [rows] = await connection.execute(
                    `SELECT id, product_code, name, price, category, is_active
                     FROM products
                     WHERE product_code = ?
                     FOR UPDATE`,
                    [String(productCode)]
                );
            } else {
                throw new Error(
                    'Order item is missing a product ID or product code.'
                );
            }

            if (
                rows.length !== 1 ||
                Number(rows[0].is_active) !== 1
            ) {
                throw new Error(
                    `A product in order ${reference} is unavailable.`
                );
            }

            const product = rows[0];

            let unitPrice;
            let productSize = null;

            if (variantId !== null) {
                const [variants] = await connection.execute(
                    `SELECT id, product_id, size, price
                     FROM product_variants
                     WHERE id = ? AND product_id = ?
                     FOR UPDATE`,
                    [variantId, product.id]
                );

                if (variants.length !== 1) {
                    throw new Error(
                        `Invalid selected variant for ${product.name}.`
                    );
                }

                const variant = variants[0];

                unitPrice = Number(variant.price);
                productSize = String(variant.size);

                const submittedSize =
                    item.productSize ??
                    item.product_size ??
                    item.size;

                if (
                    submittedSize &&
                    String(submittedSize).trim() !== productSize
                ) {
                    throw new Error(
                        `Selected size does not match the variant for ${product.name}.`
                    );
                }
            } else {
                const [variants] = await connection.execute(
                    `SELECT id
                     FROM product_variants
                     WHERE product_id = ?
                     LIMIT 1`,
                    [product.id]
                );

                if (variants.length) {
                    throw new Error(
                        `Please select a size for ${product.name}.`
                    );
                }

                unitPrice = Number(product.price);
                productSize =
                    item.productSize ||
                    item.product_size ||
                    item.size ||
                    null;
            }

            if (!Number.isFinite(unitPrice) || unitPrice < 0) {
                throw new Error(
                    `Invalid database price for ${product.name}.`
                );
            }

            if (isCaps(product) && quantity !== 1) {
                throw new Error(
                    `Caps are unique items: ${product.name}.`
                );
            }

            const priceInKobo = Math.round(unitPrice * 100);

            if (!Number.isSafeInteger(priceInKobo)) {
                throw new Error(
                    `Invalid price for ${product.name}.`
                );
            }

            const lineTotalInKobo = priceInKobo * quantity;

            if (!Number.isSafeInteger(lineTotalInKobo)) {
                throw new Error('The order total is too large.');
            }

            subtotalInKobo += lineTotalInKobo;

            if (!Number.isSafeInteger(subtotalInKobo)) {
                throw new Error('The order subtotal is too large.');
            }

            orderItems.push({
                productId: Number(product.id),
                variantId,
                productName: String(product.name).slice(0, 255),
                productSize,
                quantity,
                unitPrice,
                totalPrice: lineTotalInKobo / 100
            });
        }

        if (rawPromoDiscountInKobo > subtotalInKobo) {
            throw new Error(
                'Promotion discount exceeds the order subtotal.'
            );
        }

        const calculatedTotalInKobo =
            subtotalInKobo -
            rawPromoDiscountInKobo +
            Math.round(surcharge * 100);

        if (
            Math.abs(calculatedTotalInKobo - Number(paymentData.amount)) > 0
        ) {
            throw new Error(
                `Payment amount does not match the verified order total for ${reference}.`
            );
        }

        const subtotal = subtotalInKobo / 100;

        await connection.execute(
            `UPDATE orders
             SET subtotal = ?,
                 promo_code_id = ?,
                 promo_code = ?,
                 discount_amount = ?,
                 express_surcharge = ?,
                 total_amount = ?,
                 currency = 'NGN'
             WHERE id = ?`,
            [
                subtotal.toFixed(2),
                promoId,
                promoCode || null,
                (rawPromoDiscountInKobo / 100).toFixed(2),
                surcharge.toFixed(2),
                amount.toFixed(2),
                orderId
            ]
        );

        const [existingItems] = await connection.execute(
            `SELECT id
             FROM order_items
             WHERE order_id = ?
             LIMIT 1`,
            [orderId]
        );

        if (!existingItems.length) {
            for (const item of orderItems) {
                await connection.execute(
                    `INSERT INTO order_items
                        (
                            order_id,
                            product_id,
                            variant_id,
                            product_name,
                            product_size,
                            quantity,
                            unit_price,
                            total_price
                        )
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        orderId,
                        item.productId,
                        item.variantId,
                        item.productName,
                        item.productSize,
                        item.quantity,
                        item.unitPrice.toFixed(2),
                        item.totalPrice.toFixed(2)
                    ]
                );
            }
        }

        await connection.execute(
            `INSERT INTO payments
                (
                    order_id,
                    paystack_reference,
                    paystack_transaction_id,
                    amount,
                    currency,
                    payment_status,
                    payment_channel,
                    paid_at,
                    gateway_response
                )
             VALUES (?, ?, ?, ?, ?, 'success', ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE
                order_id = VALUES(order_id),
                payment_status = 'success'`,
            [
                orderId,
                reference,
                paymentData.id != null
                    ? String(paymentData.id)
                    : null,
                amount.toFixed(2),
                currency,
                paymentData.channel || null,
                String(
                    paymentData.gateway_response || ''
                ).slice(0, 60000) || null
            ]
        );

        if (promoCode) {
            await promoService.redeemPromoUsage(connection, {
                reservationToken,
                reference,
                orderId,
                promoId,
                promoCode,
                discountInKobo: rawPromoDiscountInKobo,
                subtotalInKobo
            });
        }
        await connection.commit();

        console.log(
            `Order, items and payment saved: ${reference}`
        );

        return orderId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// =====================================================
// SEND RECEIPT ONCE
// =====================================================

async function sendReceiptOnce(paymentData, metadata = {}) {
    const reference = String(
        paymentData.reference || ''
    ).trim();

    const customerEmail = String(
        paymentData.customer?.email ||
        metadata.email ||
        ''
    ).trim();

    const customerName = String(
        metadata.customerName ||
        metadata.name ||
        [
            paymentData.customer?.first_name,
            paymentData.customer?.last_name
        ].filter(Boolean).join(' ') ||
        (customerEmail
            ? customerEmail.split('@')[0]
            : 'Customer')
    ).trim();

    const cart = normalizeCart(metadata.cart);

    if (!reference || !customerEmail || !cart.length) {
        console.error(
            'Receipt skipped: reference, email, or cart is missing.'
        );
        return;
    }

    const [claim] = await db.promise().execute(
        `INSERT INTO capcentral_receipt_emails
            (reference, status)
         VALUES (?, 'sending') ON DUPLICATE KEY UPDATE status = IF(status = 'failed', 'sending', status)`,
        [reference]
    );

    if (claim.affectedRows === 0) {
        console.log(`Receipt already claimed: ${reference}`);
        return;
    }

    try {
        await sendProductPaymentConfirmationEmail(
            {
                name: customerName,
                email: customerEmail
            },
            cart,
            Number(paymentData.amount) / 100,
            normalizeDeliveryOption(metadata.deliveryOption),
            Number(metadata.expressSurcharge) || 0,
            reference
        );

        await db.promise().execute(
            `UPDATE capcentral_receipt_emails
             SET status = 'sent'
             WHERE reference = ?`,
            [reference]
        );

        console.log(`Receipt email sent: ${reference}`);
    } catch (error) {
        await db.promise().execute(
            `UPDATE capcentral_receipt_emails
             SET status = 'failed'
             WHERE reference = ?`,
            [reference]
        ).catch(dbError => {
            console.error(
                'Could not update receipt status:',
                dbError.message
            );
        });

        console.error(
            'Receipt email failed:',
            error.stack || error.message
        );
    }
}

async function processVerifiedSuccessfulPayment(paymentData, metadata = {}) {
    const reference = String(paymentData?.reference || '').trim();

    if (!reference || String(paymentData?.status || '').toLowerCase() !== 'success') {
        throw new Error('Successful payment verification is required to complete an order.');
    }

    const cart = normalizeCart(metadata.cart);

    await processVerifiedPaymentStock(paymentData, metadata, cart);
    await savePaidOrder(paymentData, metadata);
    await sendReceiptOnce(paymentData, { ...metadata, cart });
}

exports.processVerifiedSuccessfulPayment = processVerifiedSuccessfulPayment;
exports.associateVerifiedPayment = associateVerifiedPayment;

// =====================================================
// RENDER CHECKOUT PAGE
// =====================================================

async function getAuthoritativeCheckoutCart(value) {
    const cart = normalizeCart(value);

    if (!cart.length) {
        throw new Error('Your cart is empty or invalid.');
    }

    const pricedCart = [];

    for (const item of cart) {
        const rawId = item.productId ?? item.product_id ?? item.id;
        const productId = Number(rawId);
        const productCode = item.productCode || item.product_code;
        const quantity = Number(item.quantity ?? 1);
        const variantId = getVariantId(item);

        if (!Number.isSafeInteger(quantity) || quantity < 1) {
            throw new Error('Invalid product quantity.');
        }

        let products;

        if (Number.isSafeInteger(productId) && productId > 0) {
            [products] = await db.promise().execute(
                `SELECT id, name, category, price, is_active
                 FROM products
                 WHERE id = ?`,
                [productId]
            );
        } else if (productCode) {
            [products] = await db.promise().execute(
                `SELECT id, name, category, price, is_active
                 FROM products
                 WHERE product_code = ?`,
                [String(productCode)]
            );
        } else {
            throw new Error('A cart item is missing its product ID or product code.');
        }

        if (products.length !== 1 || Number(products[0].is_active) !== 1) {
            throw new Error('A product in your cart is unavailable.');
        }

        const product = products[0];
        let unitPrice;
        let productSize = item.productSize || item.product_size || item.size || null;

        if (variantId !== null) {
            const [variants] = await db.promise().execute(
                `SELECT id, size, price
                 FROM product_variants
                 WHERE id = ? AND product_id = ?`,
                [variantId, product.id]
            );

            if (variants.length !== 1) {
                throw new Error(`The selected size for ${product.name} is unavailable.`);
            }

            unitPrice = Number(variants[0].price);
            productSize = String(variants[0].size);
        } else {
            const [variants] = await db.promise().execute(
                `SELECT id
                 FROM product_variants
                 WHERE product_id = ?
                 LIMIT 1`,
                [product.id]
            );

            if (variants.length) {
                throw new Error(`Please select a size for ${product.name}.`);
            }

            unitPrice = Number(product.price);
        }

        const priceInKobo = Math.round(unitPrice * 100);

        if (!Number.isSafeInteger(priceInKobo) || priceInKobo < 0) {
            throw new Error(`Invalid price for ${product.name}.`);
        }

        pricedCart.push({
            ...item,
            productId: Number(product.id),
            variantId,
            name: product.name,
            size: productSize,
            quantity,
            price: priceInKobo / 100
        });
    }

    return pricedCart;
}

function getCartSubtotalInKobo(cart) {
    const subtotalInKobo = cart.reduce(
        (total, item) => total + Math.round(Number(item.price) * 100) * item.quantity,
        0
    );

    if (!Number.isSafeInteger(subtotalInKobo) || subtotalInKobo <= 0) {
        throw new Error('Invalid order subtotal.');
    }

    return subtotalInKobo;
}

exports.renderCheckoutPage = async (req, res) => {
    try {
        const { cart, returnUrl } = req.body;
        const pricedCart = await getAuthoritativeCheckoutCart(cart);
        const subtotalInKobo = getCartSubtotalInKobo(pricedCart);

        let customer = {
            email: '',
            phone_number: '',
            address: ''
        };

        const userId = Number(req.session?.user?.id);

        if (
            Number.isSafeInteger(userId) &&
            userId > 0
        ) {
            const [rows] = await db.promise().execute(
                `SELECT username, email, phone_number, address
                 FROM signup
                 WHERE id = ?
                 LIMIT 1`,
                [userId]
            );

            if (!rows.length) {
                return res.redirect('/login');
            }

            customer = rows[0];
        }

        return res.render('checkout', {
            cart: pricedCart,
            total: subtotalInKobo / 100,
            returnUrl: returnUrl || '/products',
            customer
        });
    } catch (error) {
        console.error(
            'Error rendering checkout:',
            error.stack || error.message
        );

        return res.status(500).send(
            'Unable to load checkout page.'
        );
    }
};

exports.previewPromoCode = async (req, res) => {
    try {
        const cart = await getAuthoritativeCheckoutCart(req.body?.cart);
        const subtotalInKobo = getCartSubtotalInKobo(cart);
        const promo = await promoService.validatePromoCode(
            req.body?.promoCode,
            subtotalInKobo
        );

        return res.json({
            valid: true,
            code: promo.code,
            discountInKobo: promo.discountInKobo,
            discountAmount: promo.discountAmount,
            subtotalInKobo
        });
    } catch (error) {
        return res.status(400).json({
            valid: false,
            message: error.message || 'Unable to apply this promotion code.'
        });
    }
};

// =====================================================
// INITIALIZE PAYSTACK PAYMENT
// =====================================================

exports.handlePaystackInit = async (req, res) => {
    let reservationToken;

    try {
        const {
            email,
            cart,
            deliveryOption,
            returnUrl,
            deliveryAddress,
            promoCode
        } = req.body;

        const cartParsed = normalizeCart(cart);

        if (!cartParsed.length) {
            return res.status(400).send(
                'Your cart is empty or invalid.'
            );
        }

        const sessionUserId = Number(req.session?.user?.id);

        const isLoggedIn =
            Number.isSafeInteger(sessionUserId) &&
            sessionUserId > 0;

        let customerEmail = String(email || '').trim();
        let customerAddress = String(
            deliveryAddress || ''
        ).trim();

        let customerName = '';
        let customerPhone = '';

        if (isLoggedIn) {
            const [users] = await db.promise().execute(
                `SELECT username, email, phone_number, address
                 FROM signup
                 WHERE id = ?
                 LIMIT 1`,
                [sessionUserId]
            );

            if (!users.length) {
                return res.status(401).send(
                    'Your account could not be verified. Please log in again.'
                );
            }

            const savedCustomer = users[0];

            customerEmail = String(
                savedCustomer.email || ''
            ).trim();

            customerName = savedCustomer.username || '';
            customerPhone = savedCustomer.phone_number || '';

            if (!customerAddress) {
                customerAddress = String(
                    savedCustomer.address || ''
                ).trim();
            }
        }

        if (!customerEmail) {
            return res.status(400).send(
                'Please provide your email address.'
            );
        }

        if (!customerAddress) {
            return res.status(400).send(
                'Please enter the full delivery address.'
            );
        }

        const normalizedDeliveryOption =
            normalizeDeliveryOption(deliveryOption);

        const DELIVERY_SURCHARGES = {
            standard: 0,
            express: 2000
        };

        const normalizedSurcharge =
            DELIVERY_SURCHARGES[normalizedDeliveryOption];

        if (normalizedSurcharge === undefined) {
            return res.status(400).send(
                'Invalid delivery option.'
            );
        }

        let subtotalInKobo = 0;

        const connection = await db.promise().getConnection();

        try {
            const quantities = new Map();

            for (const item of cartParsed) {
                const rawId =
                    item.productId ??
                    item.product_id ??
                    item.id;

                const id = Number(rawId);

                const code =
                    item.productCode ||
                    item.product_code;

                const quantity = Number(item.quantity ?? 1);
                const variantId = getVariantId(item);

                if (
                    !Number.isSafeInteger(quantity) ||
                    quantity < 1
                ) {
                    return res.status(400).send(
                        'Invalid product quantity.'
                    );
                }

                let rows = [];

                if (
                    rawId &&
                    Number.isSafeInteger(id) &&
                    id > 0
                ) {
                    [rows] = await connection.execute(
                        `SELECT id, name, category, price,
                                stock_quantity, is_active
                         FROM products
                         WHERE id = ?`,
                        [id]
                    );
                } else if (code) {
                    [rows] = await connection.execute(
                        `SELECT id, name, category, price,
                                stock_quantity, is_active
                         FROM products
                         WHERE product_code = ?`,
                        [String(code)]
                    );
                } else {
                    return res.status(400).send(
                        'A cart item is missing its product ID or product code.'
                    );
                }

                if (
                    rows.length !== 1 ||
                    Number(rows[0].is_active) !== 1
                ) {
                    return res.status(409).send(
                        'A product is unavailable. Please refresh your cart.'
                    );
                }

                const product = rows[0];
                const productId = Number(product.id);

                // Normalize the ID so the reservation helper can use it.
                item.productId = productId;

                let price;
                let availableStock;

                if (variantId !== null) {
                    const [variants] = await connection.execute(
                        `SELECT id, product_id, size, price, stock_quantity
                         FROM product_variants
                         WHERE id = ? AND product_id = ?`,
                        [variantId, productId]
                    );

                    if (variants.length !== 1) {
                        return res.status(409).send(
                            `The selected size for ${product.name} is unavailable.`
                        );
                    }

                    const variant = variants[0];

                    const submittedSize =
                        item.productSize ??
                        item.product_size ??
                        item.size;

                    if (
                        submittedSize &&
                        String(submittedSize).trim() !==
                            String(variant.size)
                    ) {
                        return res.status(409).send(
                            `The selected size for ${product.name} has changed. Please refresh your cart.`
                        );
                    }

                    item.variantId = Number(variant.id);
                    item.productSize = String(variant.size);

                    price = Number(variant.price);
                    availableStock = Number(
                        variant.stock_quantity
                    );
                } else {
                    const [variants] = await connection.execute(
                        `SELECT id
                         FROM product_variants
                         WHERE product_id = ?
                         LIMIT 1`,
                        [productId]
                    );

                    if (variants.length) {
                        return res.status(409).send(
                            `Please select a size for ${product.name}.`
                        );
                    }

                    price = Number(product.price);
                    availableStock = Number(
                        product.stock_quantity
                    );

                    item.variantId = null;
                }

                if (
                    !Number.isFinite(price) ||
                    price < 0
                ) {
                    return res.status(400).send(
                        `Invalid price for ${product.name}.`
                    );
                }

                const priceInKobo = Math.round(price * 100);

                if (!Number.isSafeInteger(priceInKobo)) {
                    return res.status(400).send(
                        `Invalid price for ${product.name}.`
                    );
                }

                const key =
                    `${productId}:${variantId || 'product'}`;

                const previous = quantities.get(key);

                const combinedQuantity =
                    (previous?.quantity || 0) + quantity;

                if (!Number.isSafeInteger(combinedQuantity)) {
                    return res.status(400).send(
                        'Invalid combined product quantity.'
                    );
                }

                quantities.set(key, {
                    product,
                    priceInKobo,
                    availableStock,
                    quantity: combinedQuantity
                });
            }

            for (const entry of quantities.values()) {
                const {
                    product,
                    priceInKobo,
                    availableStock,
                    quantity
                } = entry;

                if (isCaps(product) && quantity !== 1) {
                    return res.status(409).send(
                        `Caps are unique items. Quantity must be one for ${product.name}.`
                    );
                }

                if (availableStock < quantity) {
                    return res.status(409).send(
                        `${product.name} is unavailable in the requested quantity.`
                    );
                }

                subtotalInKobo += priceInKobo * quantity;

                if (!Number.isSafeInteger(subtotalInKobo)) {
                    return res.status(400).send(
                        'The order total is too large.'
                    );
                }
            }
        } finally {
            connection.release();
        }

        let promoResult = null;

        if (String(promoCode || '').trim()) {
            try {
                promoResult = await promoService.validatePromoCode(
                    promoCode,
                    subtotalInKobo
                );
            } catch (promoError) {
                return res.status(400).send(promoError.message);
            }
        }

        const discountInKobo =
            promoResult?.discountInKobo || 0;

        let amountInKobo =
            subtotalInKobo - discountInKobo + normalizedSurcharge * 100;

        if (
            !Number.isSafeInteger(amountInKobo) ||
            amountInKobo <= 0
        ) {
            return res.status(400).send(
                'Invalid payment amount.'
            );
        }

        let safeReturnUrl = returnUrl || '/products';

        if (
            typeof safeReturnUrl !== 'string' ||
            !safeReturnUrl.startsWith('/') ||
            safeReturnUrl.startsWith('//')
        ) {
            safeReturnUrl = '/products';
        }

        reservationToken = createReservationToken();
        const paymentReference = createPaystackReference();

        const reservationConnection = await db.promise().getConnection();
        try {
            await reservationConnection.beginTransaction();

            if (String(promoCode || '').trim()) {
                promoResult = await promoService.reservePromoUsage(
                    promoCode,
                    subtotalInKobo,
                    reservationToken,
                    reservationConnection,
                    paymentReference
                );
            }

            const finalDiscountInKobo = promoResult?.discountInKobo || 0;
            amountInKobo = subtotalInKobo - finalDiscountInKobo + normalizedSurcharge * 100;

            if (!Number.isSafeInteger(amountInKobo) || amountInKobo <= 0) {
                throw new Error('Invalid payment amount.');
            }

            await reserveInventory(
                reservationToken,
                cartParsed,
                reservationConnection,
                paymentReference
            );

            await reservationConnection.execute(
                `INSERT INTO payment_initialization_attempts
                    (reservation_token, paystack_reference,
                     initialization_status, expected_amount, currency)
                 VALUES (?, ?, 'prepared', ?, 'NGN')`,
                [reservationToken, paymentReference, amountInKobo]
            );

            await reservationConnection.commit();
        } catch (reservationError) {
            await reservationConnection.rollback();
            throw reservationError;
        } finally {
            reservationConnection.release();
        }

        const paymentData = await initializeAttempt({
            reference: paymentReference,
            markInFlight: reference =>
                markPaymentAttemptInFlight(reservationToken, reference),
            initialize: reference =>
                paystackService.initializeTransaction(
                customerEmail,
                amountInKobo,
                cartParsed,
                normalizedDeliveryOption,
                normalizedSurcharge,
                safeReturnUrl,
                customerAddress,
                customerName,
                isLoggedIn ? sessionUserId : null,
                customerPhone,
                reservationToken,
                promoResult?.code || null,
                promoResult?.id || null,
                promoResult?.discountInKobo || 0,
                reference
            ),
            markInitialized: reference =>
                markPaymentAttemptInitialized(reservationToken, reference),
            rejectAndRelease: (reference, error) =>
                releaseReservation(reservationToken, reference, {
                    mode: 'reject_and_release',
                    rejectionDetail: error.response?.data?.message || error.message
                }),
            isDefinitiveRejection: isDefinitiveInitializationRejection,
            validateResponse: response => {
                if (!response?.authorization_url) {
                    throw new Error('Paystack returned an incomplete initialization response.');
                }
            }
        });

        console.log(
            'Paystack payment initialized:',
            paymentData.reference
        );

        return res.redirect(paymentData.authorization_url);
    } catch (error) {
        console.error(
            'Paystack initialization error:',
            error.response?.data ||
            error.stack ||
            error.message
        );

        return res.status(500).send(
            'Unable to initialize payment. If you were redirected to Paystack, contact support before retrying.'
        );
    }
};

// =====================================================
// PAYSTACK CALLBACK
// =====================================================

exports.handlePaystackCallback = async (req, res) => {
    try {
        const reference = String(
            req.query.reference || ''
        ).trim();

        if (!reference) {
            return res.render('failure', {
                data: {
                    status: 'error',
                    reference: ''
                }
            });
        }

        const paymentData =
            await paystackService.verifyTransaction(reference);

        if (String(paymentData?.reference || '') !== reference) {
            throw new Error('Paystack verification reference mismatch.');
        }

        const metadata = parsePaystackMetadata(
            paymentData.metadata || {}
        );

        const cart = normalizeCart(metadata.cart);
        const token = String(
            metadata.reservationToken || ''
        ).trim();

        if (token) {
            await associateVerifiedPayment(paymentData, reference, metadata);
        }

        if (paymentData.status !== 'success') {
            if (
                token &&
                ['failed', 'abandoned'].includes(
                    String(paymentData.status || '').toLowerCase()
                )
            ) {
                await releaseReservation(token, reference, { mode: 'verified' });
            }

            return res.render('failure', {
                data: paymentData
            });
        }

        await processVerifiedSuccessfulPayment(paymentData, {
            ...metadata,
            cart
        });

        let returnUrl = metadata.returnUrl || '/products';

        if (
            typeof returnUrl !== 'string' ||
            !returnUrl.startsWith('/') ||
            returnUrl.startsWith('//')
        ) {
            returnUrl = '/products';
        }

        return req.session.save(error => {
            if (error) {
                console.error(
                    'Session save failed:',
                    error.message
                );

                return res.status(500).send(
                    'Payment was successful, but the session could not be preserved. Please return to the shop.'
                );
            }

            const redirectUrl =
                `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=success`;

            return res.redirect(redirectUrl);
        });
    } catch (error) {
        console.error(
            'Paystack callback error:',
            error.response?.data ||
            error.stack ||
            error.message
        );

        return res.render('failure', {
            data: {
                status: 'error',
                reference: req.query.reference || ''
            }
        });
    }
};

// =====================================================
// PAYSTACK WEBHOOK
// =====================================================

exports.handlePaystackWebhook = async (req, res) => {
    try {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        const signature = req.headers["x-paystack-signature"];

        if (
            !secret ||
            !Buffer.isBuffer(req.rawBody) ||
            typeof signature !== "string" ||
            !/^[a-f0-9]{128}$/i.test(signature)
        ) {
            return res.sendStatus(401);
        }

        const expectedSignature = crypto
            .createHmac("sha512", secret)
            .update(req.rawBody)
            .digest();

        const receivedSignature = Buffer.from(signature, "hex");

        if (!crypto.timingSafeEqual(expectedSignature, receivedSignature)) {
            return res.sendStatus(401);
        }

        const event = req.body || {};

        if (event.event !== 'charge.success') {
            return res.sendStatus(200);
        }

        const reference = String(
            event.data?.reference || ''
        ).trim();

        if (!reference) {
            return res.sendStatus(200);
        }

        // Verify independently with Paystack.
        const paymentData =
            await paystackService.verifyTransaction(reference);

        if (String(paymentData?.reference || '') !== reference) {
            throw new Error('Paystack verification reference mismatch.');
        }

        if (paymentData.status !== 'success') {
            return res.sendStatus(200);
        }

        const metadata = parsePaystackMetadata(
            paymentData.metadata || {}
        );

        const cart = normalizeCart(metadata.cart);

        if (metadata.reservationToken) {
            await associateVerifiedPayment(paymentData, reference, metadata);
        }

        await processVerifiedSuccessfulPayment(paymentData, {
            ...metadata,
            cart
        });

        console.log(
            'Paystack webhook processing completed:',
            reference
        );

        return res.sendStatus(200);
    } catch (error) {
        console.error(
            'Paystack webhook error:',
            error.response?.data ||
            error.stack ||
            error.message
        );

        return res.sendStatus(500);
    }
};
