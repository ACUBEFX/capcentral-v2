
const crypto = require('crypto');
const paystackService = require('../services/paystackService');
const db = require('../models/database');

const {
    sendProductPaymentConfirmationEmail
} = require('../utils/mailer');

// =====================================================
// GENERAL HELPERS
// =====================================================

function createReservationToken() {
    return crypto.randomUUID();
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

async function reserveInventory(reservationToken, cart) {
    if (!reservationToken || !Array.isArray(cart) || !cart.length) {
        throw new Error('Invalid inventory reservation request.');
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

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
                        product_id,
                        variant_id,
                        quantity,
                        status,
                        expires_at
                    )
                 VALUES (
                    ?, ?, ?, ?, 'reserved',
                    DATE_ADD(NOW(), INTERVAL 30 MINUTE)
                 )`,
                [reservationToken, productId, variantId, quantity]
            );
        }

        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// =====================================================
// RELEASE INVENTORY RESERVATION
// =====================================================

async function releaseReservation(reservationToken) {
    if (!reservationToken) return;

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [reservations] = await connection.execute(
            `SELECT id, product_id, variant_id, quantity
             FROM inventory_reservations
             WHERE reservation_token = ?
               AND status = 'reserved'
             FOR UPDATE`,
            [reservationToken]
        );

        for (const reservation of reservations) {
            const [updated] = await connection.execute(
                `UPDATE inventory_reservations
                 SET status = 'released'
                 WHERE id = ?
                   AND status = 'reserved'`,
                [reservation.id]
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

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// =====================================================
// LINK RESERVATION TO PAYSTACK
// =====================================================

async function linkReservationToPayment(reservationToken, reference) {
    if (!reservationToken || !reference) {
        throw new Error(
            'Reservation token and payment reference are required.'
        );
    }

    const [result] = await db.promise().execute(
        `UPDATE inventory_reservations
         SET paystack_reference = ?
         WHERE reservation_token = ?
           AND status = 'reserved'`,
        [reference, reservationToken]
    );

    if (result.affectedRows === 0) {
        const [rows] = await db.promise().execute(
            `SELECT id
             FROM inventory_reservations
             WHERE reservation_token = ?
               AND paystack_reference = ?`,
            [reservationToken, reference]
        );

        if (!rows.length) {
            throw new Error(
                'Could not link the inventory reservation to Paystack.'
            );
        }
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

        const calculatedTotalInKobo =
            subtotalInKobo + Math.round(surcharge * 100);

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
                 express_surcharge = ?,
                 total_amount = ?,
                 currency = 'NGN'
             WHERE id = ?`,
            [
                subtotal.toFixed(2),
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

// =====================================================
// RENDER CHECKOUT PAGE
// =====================================================

exports.renderCheckoutPage = async (req, res) => {
    try {
        const { cart, total, returnUrl } = req.body;

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
            cart: normalizeCart(cart),
            total,
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

// =====================================================
// INITIALIZE PAYSTACK PAYMENT
// =====================================================

exports.handlePaystackInit = async (req, res) => {
    let reservationToken;
    let paymentInitialized = false;

    try {
        const {
            email,
            cart,
            deliveryOption,
            returnUrl,
            deliveryAddress
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

        const amountInKobo =
            subtotalInKobo + normalizedSurcharge * 100;

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

        await reserveInventory(
            reservationToken,
            cartParsed
        );

        const paymentData =
            await paystackService.initializeTransaction(
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
                reservationToken
            );

        paymentInitialized = true;

        if (
            !paymentData?.authorization_url ||
            !paymentData?.reference
        ) {
            throw new Error(
                'Paystack returned an incomplete initialization response.'
            );
        }

        try {
            await linkReservationToPayment(
                reservationToken,
                paymentData.reference
            );
        } catch (linkError) {
            console.error(
                'Could not link reservation reference; preserving reservation:',
                linkError.message
            );
        }

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

        if (
            reservationToken &&
            !paymentInitialized &&
            error.response &&
            error.response.status >= 400 &&
            error.response.status < 500
        ) {
            try {
                await releaseReservation(reservationToken);
            } catch (releaseError) {
                console.error(
                    'Failed to release reservation:',
                    releaseError.message
                );
            }
        }

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

        const metadata = parsePaystackMetadata(
            paymentData.metadata || {}
        );

        const cart = normalizeCart(metadata.cart);
        const token = String(
            metadata.reservationToken || ''
        ).trim();

        if (paymentData.status !== 'success') {
            if (
                token &&
                ['failed', 'abandoned'].includes(
                    String(paymentData.status || '').toLowerCase()
                )
            ) {
                await releaseReservation(token);
            }

            return res.render('failure', {
                data: paymentData
            });
        }

        await processVerifiedPaymentStock(
            paymentData,
            metadata,
            cart
        );

        await savePaidOrder(paymentData, metadata);

        await sendReceiptOnce(paymentData, {
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

        if (paymentData.status !== 'success') {
            return res.sendStatus(200);
        }

        const metadata = parsePaystackMetadata(
            paymentData.metadata || {}
        );

        const cart = normalizeCart(metadata.cart);

        await processVerifiedPaymentStock(
            paymentData,
            metadata,
            cart
        );

        await savePaidOrder(paymentData, metadata);

        await sendReceiptOnce(paymentData, {
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
