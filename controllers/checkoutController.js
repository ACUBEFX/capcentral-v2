
const crypto = require('crypto');
const paystackService = require('../services/paystackService');
const db = require('../models/database');

const {
    sendProductPaymentConfirmationEmail
} = require('../utils/mailer');

// =====================================================
// RESERVATION HELPERS
// =====================================================

function createReservationToken() {
    return crypto.randomUUID();
}

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

            const quantity = Number(item.quantity ?? 1);

            if (
                !Number.isSafeInteger(productId) ||
                productId <= 0 ||
                !Number.isSafeInteger(quantity) ||
                quantity <= 0
            ) {
                throw new Error(
                    'Every cart item must have a valid product ID and quantity.'
                );
            }

            quantities.set(
                productId,
                (quantities.get(productId) || 0) + quantity
            );
        }

        const productIds = [...quantities.keys()].sort((a, b) => a - b);

        for (const productId of productIds) {
            const quantity = quantities.get(productId);

            const [rows] = await connection.execute(
                `SELECT id, name, category, stock_quantity, is_active
                 FROM products
                 WHERE id = ?
                 FOR UPDATE`,
                [productId]
            );

            if (rows.length !== 1 || Number(rows[0].is_active) !== 1) {
                throw new Error(`Product ${productId} is unavailable.`);
            }

            const product = rows[0];

            if (product.category === 'Caps' && quantity !== 1) {
                throw new Error(
                    `Caps are unique items. Quantity must be one for ${product.name}.`
                );
            }

            const [updated] = await connection.execute(
                `UPDATE products
                 SET stock_quantity = stock_quantity - ?
                 WHERE id = ?
                   AND is_active = 1
                   AND stock_quantity >= ?`,
                [quantity, productId, quantity]
            );

            if (updated.affectedRows !== 1) {
                throw new Error(
                    `Insufficient available stock for ${product.name}.`
                );
            }

            await connection.execute(
                `INSERT INTO inventory_reservations
                    (
                        reservation_token,
                        product_id,
                        quantity,
                        status,
                        expires_at
                    )
                 VALUES (
                    ?, ?, ?, 'reserved',
                    DATE_ADD(NOW(), INTERVAL 30 MINUTE)
                 )`,
                [reservationToken, productId, quantity]
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

// Restores stock only when a reservation is successfully released.
// The transaction prevents duplicate releases from restoring stock twice.
async function releaseReservation(reservationToken) {
    if (!reservationToken) return;

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [reservations] = await connection.execute(
            `SELECT id, product_id, quantity
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
                `UPDATE products
                SET stock_quantity = stock_quantity + ?
                WHERE id = ?`,
                [reservation.quantity, reservation.product_id]
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

async function linkReservationToPayment(reservationToken, reference) {
    if (!reservationToken || !reference) {
        throw new Error('Reservation token and payment reference are required.');
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
            throw new Error('Could not link the inventory reservation to Paystack.');
        }
    }
}

// =====================================================
// NORMALIZATION HELPERS
// =====================================================

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

function normalizeDeliveryOption(value) {
    const option = Array.isArray(value) ? value[0] : value;

    return String(option || 'standard').toLowerCase() === 'express'
        ? 'express'
        : 'standard';
}

// =====================================================
// LEGACY STOCK DEDUCTION
// Used only for payments that have no reservation token.
// =====================================================

async function updatePurchasedProductStock(reference, cart) {
    if (!reference || !Array.isArray(cart) || !cart.length) {
        throw new Error('Missing payment reference or valid cart.');
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

            if (rawId && Number.isSafeInteger(productId) && productId > 0) {
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

            if (
                product.category === 'Caps' &&
                quantity !== 1
            ) {
                throw new Error(
                    `Caps are unique items: ${product.name}.`
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
// FINALIZE A RESERVED PAYMENT
// The stock was deducted when it was reserved.
// Do not deduct it a second time.
// =====================================================

async function finalizeReservationPayment(reference, reservationToken) {
    if (!reference || !reservationToken) {
        throw new Error('Missing payment reference or reservation token.');
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
            console.log(`Reservation payment already processed: ${reference}`);
            return;
        }

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
            throw new Error(
                `Reservation is not active for payment ${reference}.`
            );
        }
        
        if (reservations.some(row => row.status !== 'reserved')) {
            throw new Error(
                `Reservation is not active for payment ${reference}.`
            );
        }

        // Prevent a reservation from being finalized against another payment.
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


        await connection.execute(
            `UPDATE inventory_reservations
             SET status = 'paid',
                 paystack_reference = ?
             WHERE reservation_token = ?
               AND status = 'reserved'`,
            [reference, reservationToken]
        );

        await connection.commit();

        console.log(`Reservation finalized for payment: ${reference}`);
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
        throw new Error('Cannot save an order without a Paystack reference.');
    }

    if (String(paymentData.status || '').toLowerCase() !== 'success') {
        throw new Error('Cannot save an order for an unsuccessful payment.');
    }

    const amount = Number(paymentData.amount) / 100;

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Invalid verified Paystack amount.');
    }

    const cart = normalizeCart(metadata.cart);

    if (!cart.length) {
        throw new Error(`Cannot save order ${reference}: cart is empty.`);
    }

    const surcharge = Math.max(
        0,
        Number(metadata.expressSurcharge) || 0
    );

    const rawUserId = Number(metadata.userId);
    const userId =
        Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : null;

    const deliveryOption = normalizeDeliveryOption(metadata.deliveryOption);

    const customerEmail = String(
        paymentData.customer?.email || metadata.email || ''
    ).trim();

    if (!customerEmail) {
        throw new Error(`Missing customer email for order ${reference}.`);
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
        metadata.customerPhone || paymentData.customer?.phone || ''
    ).trim().slice(0, 20) || null;

    const deliveryAddress = String(
        metadata.deliveryAddress || ''
    ).trim().slice(0, 2000) || null;

    const currency = String(paymentData.currency || 'NGN').toUpperCase();

    if (currency !== 'NGN') {
        throw new Error(`Unexpected payment currency: ${currency}.`);
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        // Lock an existing order, if this reference was already processed.
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
            // Preserve the existing orders table structure.
            const [orderResult] = await connection.execute(
                `INSERT INTO orders
                    (
                        order_reference, user_id, customer_name,
                        customer_email, customer_phone, subtotal,
                        delivery_fee, express_surcharge, total_amount,
                        currency, order_status, delivery_address,
                        delivery_option
                    )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', 'paid', ?, ?)`,
                [
                    reference,
                    userId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    Math.max(0, amount - surcharge),
                    0,
                    surcharge,
                    amount,
                    deliveryAddress,
                    deliveryOption
                ]
            );

            orderId = orderResult.insertId;
        }

        // Resolve every cart item against the database.
        // Never use the browser's submitted price as the authoritative price.
        const orderItems = [];
        const quantitiesByProduct = new Map();

        for (const item of cart) {
            const rawId = item.productId ?? item.product_id ?? item.id;
            const productId = Number(rawId);
            const productCode = item.productCode || item.product_code;
            const quantity = Number(item.quantity ?? 1);

            if (!Number.isSafeInteger(quantity) || quantity < 1) {
                throw new Error(`Invalid quantity in order ${reference}.`);
            }

            let rows;

            if (Number.isSafeInteger(productId) && productId > 0) {
                [rows] = await connection.execute(
                    `SELECT id, product_code, name, price, is_active
                     FROM products
                     WHERE id = ?
                     FOR UPDATE`,
                    [productId]
                );
            } else if (productCode) {
                [rows] = await connection.execute(
                    `SELECT id, product_code, name, price, is_active
                     FROM products
                     WHERE product_code = ?
                     FOR UPDATE`,
                    [String(productCode)]
                );
            } else {
                throw new Error(
                    `Order item is missing a product ID or product code.`
                );
            }

            if (rows.length !== 1 || Number(rows[0].is_active) !== 1) {
                throw new Error(`A product in order ${reference} is unavailable.`);
            }

            const product = rows[0];
            const dbProductId = Number(product.id);
            const unitPrice = Number(product.price);

            if (!Number.isFinite(unitPrice) || unitPrice < 0) {
                throw new Error(`Invalid database price for ${product.name}.`);
            }

            const previousQuantity = quantitiesByProduct.get(dbProductId) || 0;
            quantitiesByProduct.set(dbProductId, previousQuantity + quantity);

            orderItems.push({
                productId: String(product.id),
                productName: String(product.name).slice(0, 255),
                productSize: item.productSize || item.product_size || null,
                quantity,
                unitPrice,
                totalPrice: Number((unitPrice * quantity).toFixed(2))
            });
        }

        // A callback and webhook may both execute. Insert items only once.
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
                            order_id, product_id, product_name,
                            product_size, quantity, unit_price, total_price
                        )
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        orderId,
                        item.productId,
                        item.productName,
                        item.productSize,
                        item.quantity,
                        item.unitPrice.toFixed(2),
                        item.totalPrice.toFixed(2)
                    ]
                );
            }
        }

        // Record the verified Paystack transaction.
        // paystack_reference has a UNIQUE index.
        await connection.execute(
            `INSERT INTO payments
                (
                    order_id, paystack_reference,
                    paystack_transaction_id, amount, currency,
                    payment_status, payment_channel, paid_at,
                    gateway_response
                )
             VALUES (?, ?, ?, ?, ?, 'success', ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE
                order_id = IF(order_id = VALUES(order_id), order_id, order_id),
                payment_status = IF(payment_status = 'success', 'success', payment_status)`,
            [
                orderId,
                reference,
                paymentData.id != null ? String(paymentData.id) : null,
                amount.toFixed(2),
                currency,
                paymentData.channel || null,
                String(paymentData.gateway_response || '').slice(0, 60000) || null
            ]
        );

        await connection.commit();

        console.log(`Order, items and payment saved: ${reference}`);
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
    const reference = String(paymentData.reference || '').trim();

    const customerEmail = String(
        paymentData.customer?.email || metadata.email || ''
    ).trim();

    const customerName = String(
        metadata.customerName ||
        metadata.name ||
        [
            paymentData.customer?.first_name,
            paymentData.customer?.last_name
        ].filter(Boolean).join(' ') ||
        (customerEmail ? customerEmail.split('@')[0] : 'Customer')
    ).trim();

    const cart = normalizeCart(metadata.cart);

    if (!reference || !customerEmail || !cart.length) {
        console.error('Receipt skipped: reference, email, or cart is missing.');
        return;
    }

    const [claim] = await db.promise().execute(
        `INSERT IGNORE INTO capcentral_receipt_emails
            (reference, status)
         VALUES (?, 'sending')`,
        [reference]
    );

    if (claim.affectedRows === 0) {
        console.log(`Receipt already claimed: ${reference}`);
        return;
    }

    try {
        await sendProductPaymentConfirmationEmail(
            { name: customerName, email: customerEmail },
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
            console.error('Could not update receipt status:', dbError.message);
        });

        console.error('Receipt email failed:', error.stack || error.message);
    }
}

// =====================================================
// RENDER CHECKOUT PAGE
// =====================================================

exports.renderCheckoutPage = (req, res) => {
    try {
        const { cart, total, returnUrl } = req.body;

        res.render('checkout', {
            cart: normalizeCart(cart),
            total,
            returnUrl: returnUrl || '/products'
        });
    } catch (error) {
        console.error('Error rendering checkout:', error.stack || error.message);
        res.status(500).send('Unable to load checkout page.');
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
            total,
            cart,
            deliveryOption,
            expressSurcharge,
            returnUrl,
            deliveryAddress
        } = req.body;

        const cartParsed = normalizeCart(cart);

        if (!cartParsed.length) {
            return res.status(400).send('Your cart is empty or invalid.');
        }

        if (!String(email || '').trim()) {
            return res.status(400).send('Please provide your email address.');
        }

        if (!String(deliveryAddress || '').trim()) {
            return res.status(400).send('Please enter the full delivery address.');
        }

     
       
const normalizedDeliveryOption =
    normalizeDeliveryOption(deliveryOption);

// These fees are controlled by the server.
const DELIVERY_SURCHARGES = {
    standard: 0,
    express: 2000
};

const normalizedSurcharge =
    DELIVERY_SURCHARGES[normalizedDeliveryOption];

if (normalizedSurcharge === undefined) {
    return res.status(400).send('Invalid delivery option.');
}

// Calculate the subtotal using database prices.
// Store amounts in kobo during calculations to avoid rounding errors.
let subtotalInKobo = 0;

const connection = await db.promise().getConnection();

try {
    const quantitiesByProduct = new Map();

    for (const item of cartParsed) {
        const rawId = item.productId ?? item.product_id ?? item.id;
        const id = Number(rawId);
        const code = item.productCode || item.product_code;
        const quantity = Number(item.quantity ?? 1);

        if (
            !Number.isSafeInteger(quantity) ||
            quantity < 1
        ) {
            return res.status(400).send('Invalid product quantity.');
        }

        let rows = [];

        if (rawId && Number.isSafeInteger(id) && id > 0) {
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
        const price = Number(product.price);
        const priceInKobo = Math.round(price * 100);

        if (
            !Number.isFinite(price) ||
            price < 0 ||
            !Number.isSafeInteger(priceInKobo)
        ) {
            return res.status(400).send(
                `Invalid price for ${product.name}.`
            );
        }

        const previous = quantitiesByProduct.get(productId);

        const combinedQuantity =
            (previous?.quantity || 0) + quantity;

        if (!Number.isSafeInteger(combinedQuantity)) {
            return res.status(400).send(
                'Invalid combined product quantity.'
            );
        }

        quantitiesByProduct.set(productId, {
            product,
            quantity: combinedQuantity
        });
    }

            // Validate combined quantities, including duplicate cart entries.
            for (const { product, quantity } of quantitiesByProduct.values()) {
                if (product.category === 'Caps' && quantity !== 1) {
                    return res.status(409).send(
                        `Caps are unique items. Quantity must be one for ${product.name}.`
                    );
                }

                if (Number(product.stock_quantity) < quantity) {
                    return res.status(409).send(
                        `${product.name} is unavailable in the requested quantity.`
                    );
                }

                const priceInKobo = Math.round(Number(product.price) * 100);

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
            return res.status(400).send('Invalid payment amount.');
        }

        const amountInNaira = amountInKobo / 100;

        let safeReturnUrl = returnUrl || '/products';

        if (
            typeof safeReturnUrl !== 'string' ||
            !safeReturnUrl.startsWith('/') ||
            safeReturnUrl.startsWith('//')
        ) {
            safeReturnUrl = '/products';
        }

        reservationToken = createReservationToken();

        // Atomically reduce stock and record the reservation.
        await reserveInventory(reservationToken, cartParsed);

        const paymentData = await paystackService.initializeTransaction(
            String(email).trim(),
            amountInKobo,
            cartParsed,
            normalizedDeliveryOption,
            normalizedSurcharge,
            safeReturnUrl,
            String(deliveryAddress).trim(),
            req.session?.user?.username || '',
            req.session?.user?.id || null,
            req.session?.user?.phone_number || '',
            reservationToken
        );

        paymentInitialized = true;

        if (!paymentData?.authorization_url || !paymentData?.reference) {
            throw new Error('Paystack returned an incomplete initialization response.');
        }

        // Metadata also carries the token, so callback/webhook can locate it.
        try {
            await linkReservationToPayment(
                reservationToken,
                paymentData.reference
            );
        } catch (linkError) {
            // Do not release stock here: Paystack has already initialized.
            console.error(
                'Could not link reservation reference; preserving reservation:',
                linkError.message
            );
        }

        console.log('Paystack payment initialized:', paymentData.reference);
        return res.redirect(paymentData.authorization_url);
    } catch (error) {
        console.error(
            'Paystack initialization error:',
            error.response?.data || error.stack || error.message
        );

        // A definite client-side rejection from Paystack can release stock.
        // For network errors or server errors, the transaction may have been
        // created even if the response was lost; keep the reservation for review.
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
        const reference = String(req.query.reference || '').trim();

        if (!reference) {
            return res.render('failure', {
                data: { status: 'error', reference: '' }
            });
        }

        const paymentData = await paystackService.verifyTransaction(reference);

        const metadata = parsePaystackMetadata(paymentData.metadata || {});
        const cart = normalizeCart(metadata.cart);
        const token = String(metadata.reservationToken || '').trim();

        if (paymentData.status !== 'success') {
            // Do not release a payment that is still pending.
            if (
                token &&
                ['failed', 'abandoned'].includes(
                    String(paymentData.status || '').toLowerCase()
                )
            ) {
                await releaseReservation(token);
            }

            return res.render('failure', { data: paymentData });
        }

        await processVerifiedPaymentStock(paymentData, metadata, cart);
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
                console.error('Session save failed:', error.message);
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
            error.response?.data || error.stack || error.message
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
        const event = req.body || {};

        if (event.event !== 'charge.success') {
            return res.sendStatus(200);
        }

        const reference = String(event.data?.reference || '').trim();

        if (!reference) {
            return res.sendStatus(200);
        }

        // Verify independently with Paystack; do not trust the webhook body.
        const paymentData = await paystackService.verifyTransaction(reference);

        if (paymentData.status !== 'success') {
            return res.sendStatus(200);
        }

        const metadata = parsePaystackMetadata(paymentData.metadata || {});
        const cart = normalizeCart(metadata.cart);

        await processVerifiedPaymentStock(paymentData, metadata, cart);
        await savePaidOrder(paymentData, metadata);

        await sendReceiptOnce(paymentData, {
            ...metadata,
            cart
        });

        console.log('Paystack webhook processing completed:', reference);
        return res.sendStatus(200);
    } catch (error) {
        console.error(
            'Paystack webhook error:',
            error.response?.data || error.stack || error.message
        );

        return res.sendStatus(500);
    }
};
