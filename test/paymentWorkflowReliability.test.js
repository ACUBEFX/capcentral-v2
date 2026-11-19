'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    sendReceiptOnce,
    STALE_RECEIPT_MINUTES
} = require('../services/receiptDelivery');
const {
    normalizeServicePaymentInput,
    validateVerifiedServicePayment
} = require('../services/servicePaymentValidation');
const { saveCapService } = require('../models/services');
const {
    isActiveVariant,
    isCapsCategory,
    resolveOrderUnitPrice
} = require('../services/checkoutIntegrity');
const { redeemPromoUsage } = require('../services/promoService');

class FakeReceiptDatabase {
    constructor(now = Date.now()) {
        this.now = now;
        this.rows = new Map();
    }

    async execute(sql, values) {
        const reference = sql.includes('INSERT IGNORE INTO capcentral_receipt_emails')
            ? values[0]
            : values[sql.includes("SET status = 'sending'") ? 1 : 0];
        const leaseToken = sql.includes('INSERT IGNORE INTO capcentral_receipt_emails')
            ? values[1]
            : sql.includes("SET status = 'sending'")
                ? values[0]
                : values[1];
        const row = this.rows.get(reference);
        if (sql.includes('INSERT IGNORE INTO capcentral_receipt_emails')) {
            if (row) return [{ affectedRows: 0 }];
            this.rows.set(reference, { status: 'sending', leaseToken, updatedAt: this.now });
            return [{ affectedRows: 1 }];
        }

        if (sql.includes("SET status = 'sending'")) {
            const stale = row?.status === 'sending' &&
                this.now - row.updatedAt >= STALE_RECEIPT_MINUTES * 60 * 1000;
            if (row && (row.status === 'failed' || stale)) {
                row.status = 'sending';
                row.leaseToken = leaseToken;
                row.updatedAt = this.now;
                return [{ affectedRows: 1 }];
            }
            return [{ affectedRows: 0 }];
        }

        if (sql.includes("SET status = 'failed'")) {
            if (row?.status === 'sending' && row.leaseToken === leaseToken) {
                row.status = 'failed';
                row.leaseToken = null;
                row.updatedAt = this.now;
                return [{ affectedRows: 1 }];
            }
            return [{ affectedRows: 0 }];
        }

        if (sql.includes("SET status = 'sent'")) {
            if (row?.status === 'sending' && row.leaseToken === leaseToken) {
                row.status = 'sent';
                row.leaseToken = null;
                row.updatedAt = this.now;
                return [{ affectedRows: 1 }];
            }
            return [{ affectedRows: 0 }];
        }

        throw new Error('Unexpected fake receipt query.');
    }
}

test('receipt claims suppress concurrent duplicates and completed retries', async () => {
    const database = new FakeReceiptDatabase();
    let sendCount = 0;
    let finishSend;
    const sendGate = new Promise(resolve => { finishSend = resolve; });

    const first = sendReceiptOnce('REF-CONCURRENT', async () => {
        sendCount += 1;
        await sendGate;
    }, database);
    await Promise.resolve();

    const second = await sendReceiptOnce('REF-CONCURRENT', async () => {
        sendCount += 1;
    }, database);
    assert.equal(second, false);
    assert.equal(sendCount, 1);

    finishSend();
    assert.equal(await first, true);
    assert.equal(database.rows.get('REF-CONCURRENT').status, 'sent');
    assert.equal(await sendReceiptOnce('REF-CONCURRENT', async () => {
        sendCount += 1;
    }, database), false);
    assert.equal(sendCount, 1);
});

test('failed receipt can retry and stale sending claim is recoverable', async () => {
    const database = new FakeReceiptDatabase();
    assert.equal(await sendReceiptOnce('REF-FAILED', async () => {
        throw new Error('mock transport failure');
    }, database), false);
    assert.equal(database.rows.get('REF-FAILED').status, 'failed');

    assert.equal(await sendReceiptOnce('REF-FAILED', async () => {}, database), true);
    assert.equal(database.rows.get('REF-FAILED').status, 'sent');

    database.rows.set('REF-STALE', {
        status: 'sending',
        leaseToken: 'old-claim',
        updatedAt: database.now - (STALE_RECEIPT_MINUTES + 1) * 60 * 1000
    });
    let retried = 0;
    assert.equal(await sendReceiptOnce('REF-STALE', async () => { retried += 1; }, database), true);
    assert.equal(retried, 1);
    assert.equal(database.rows.get('REF-STALE').status, 'sent');
});

test('a reclaimed receipt lease fences the former sender from changing final state', async () => {
    const database = new FakeReceiptDatabase();
    let finishFirstSend;
    const firstSend = new Promise(resolve => { finishFirstSend = resolve; });
    const first = sendReceiptOnce('REF-FENCED', async () => firstSend, database);
    await new Promise(resolve => setImmediate(resolve));

    database.now += (STALE_RECEIPT_MINUTES + 1) * 60 * 1000;
    assert.equal(await sendReceiptOnce('REF-FENCED', async () => {}, database), true);
    assert.equal(database.rows.get('REF-FENCED').status, 'sent');

    finishFirstSend();
    assert.equal(await first, false);
    assert.equal(database.rows.get('REF-FENCED').status, 'sent');
});

test('service pricing is calculated server-side for both service types', () => {
    const resizing = normalizeServicePaymentInput('resizing', {
        name: 'Test Customer', email: 'test@example.test', phone: '08000000000',
        capsCount: '2', capSize: '22.5', totalCost: '₦1',
        scheduleDate: '2026-11-20', deliveryOption: 'self-drop'
    });
    assert.equal(resizing.expectedAmountInKobo, 600000);
    assert.equal(resizing.formData.totalCost, '6000');

    const laundry = normalizeServicePaymentInput('laundry', {
        name: 'Test Customer', email: 'test@example.test', phone: '08000000000',
        laundryCapsCount: '3', cleaningType: 'deep', laundryTotalCost: '1',
        laundryScheduleDate: '2026-11-20', laundryDeliveryOption: 'pickup'
    });
    assert.equal(laundry.expectedAmountInKobo, 750000);
    assert.equal(laundry.formData.laundryTotalCost, '7500');
});

test('checkout rejects inactive variants and preserves the verified price snapshot', () => {
    assert.equal(isActiveVariant({ is_active: 1 }), true);
    assert.equal(isActiveVariant({ is_active: 0 }), false);
    assert.equal(isCapsCategory('Caps'), true);
    assert.equal(isCapsCategory('Clothing'), false);
    assert.equal(resolveOrderUnitPrice(1250.5, 1500), 1250.5);
    assert.equal(resolveOrderUnitPrice(undefined, 1500), 1500);
    assert.throws(() => resolveOrderUnitPrice('not-a-price', 1500));
});

test('service payment validation binds reference, payer, amount, currency and durable attempt metadata', () => {
    const success = {
        status: 'success', reference: 'CC-TEST', amount: 300000,
        currency: 'NGN', customer: { email: 'test@example.test' },
        metadata: { paymentType: 'service', servicePaymentReference: 'CC-TEST' }
    };
    const attempt = { reference: 'CC-TEST', expected_amount: 300000, currency: 'NGN', payer_email: 'test@example.test' };
    assert.equal(validateVerifiedServicePayment(success, attempt), success);

    for (const transaction of [
        { ...success, reference: 'OTHER' },
        { ...success, amount: 300001 },
        { ...success, customer: { email: 'other@example.test' } },
        { ...success, currency: 'USD' },
        { ...success, metadata: { paymentType: 'service', servicePaymentReference: 'OTHER' } }
    ]) {
        assert.throws(() => validateVerifiedServicePayment(transaction, attempt));
    }
});

class FakeServicePool {
    constructor() {
        this.processed = new Set();
        this.records = new Map();
        this.nextId = 1;
        this.tail = Promise.resolve();
    }

    async getConnection() {
        const pool = this;
        let releaseLock;
        return {
            async beginTransaction() {
                const prior = pool.tail;
                pool.tail = new Promise(resolve => { releaseLock = resolve; });
                await prior;
            },
            async execute(sql, values) {
                if (sql.includes('INSERT IGNORE INTO processed_cap_payments')) {
                    pool.processed.add(values[0]);
                    return [{ affectedRows: 1 }];
                }
                if (sql.includes('FROM cap_services')) {
                    const row = pool.records.get(values[0]);
                    return [row ? [{ id: row.id }] : []];
                }
                if (sql.includes('INSERT INTO cap_services')) {
                    const reference = values[0];
                    const row = { id: pool.nextId++, values };
                    pool.records.set(reference, row);
                    return [{ insertId: row.id }];
                }
                throw new Error('Unexpected fake service query.');
            },
            async commit() { releaseLock?.(); },
            async rollback() { releaseLock?.(); },
            release() {}
        };
    }
}

test('service persistence serializes duplicate payment callbacks', async () => {
    const database = new FakeServicePool();
    const service = {
        reference: 'CC-SERVICE-1',
        serviceType: 'resizing',
        formData: {
            name: 'Test Customer', email: 'test@example.test', phone: '08000000000',
            capsCount: 1, totalCost: '3000', scheduleDate: '2026-11-20',
            deliveryOption: 'self-drop', capSize: '22'
        }
    };

    const results = await Promise.all([
        saveCapService(service, database),
        saveCapService(service, database)
    ]);
    assert.equal(database.records.size, 1);
    assert.equal(database.processed.size, 1);
    assert.equal(results[0].id, results[1].id);
    assert.equal(results.filter(result => result.created).length, 1);
});

test('laundry persistence stores the submitted laundry schedule date', async () => {
    const database = new FakeServicePool();
    await saveCapService({
        reference: 'CC-LAUNDRY-1',
        serviceType: 'laundry',
        formData: {
            name: 'Test Customer', email: 'test@example.test', phone: '08000000000',
            laundryCapsCount: 1, cleaningType: 'standard', laundryTotalCost: '1500',
            laundryScheduleDate: '2026-11-20', laundryDeliveryOption: 'self-drop'
        }
    }, database);

    const persistedValues = database.records.get('CC-LAUNDRY-1').values;
    assert.equal(persistedValues[8], '2026-11-20 09:00:00');
});

class FakePromoConnection {
    constructor(status = 'reserved') {
        this.status = status;
        this.reference = 'PAY-1';
        this.redemptions = status === 'redeemed'
            ? [{ promo_code_id: 7, order_id: 9, paystack_reference: 'PAY-1', discount_amount: '10.00' }]
            : [];
        this.insertCount = 0;
    }

    async execute(sql) {
        if (sql.includes('FROM promo_usage_reservations')) {
            return [[{ promo_code_id: 7, paystack_reference: this.reference, status: this.status }]];
        }
        if (sql.includes('SELECT *') && sql.includes('FROM promo_codes')) {
            // Admin edited/deactivated the code after checkout reserved it.
            return [[{ id: 7, code: 'EDITED', is_active: 0, min_order_amount: 9999, discount_type: 'fixed', discount_value: 1 }]];
        }
        if (sql.includes('FROM promo_redemptions')) return [this.redemptions];
        if (sql.includes('INSERT INTO promo_redemptions')) {
            this.insertCount += 1;
            this.redemptions.push({
                promo_code_id: 7, order_id: 9, paystack_reference: 'PAY-1', discount_amount: '10.00'
            });
            return [{ affectedRows: 1 }];
        }
        if (sql.includes('UPDATE promo_codes')) return [{ affectedRows: 1 }];
        if (sql.includes('UPDATE promo_usage_reservations')) {
            this.status = 'redeemed';
            return [{ affectedRows: 1 }];
        }
        throw new Error('Unexpected fake promo query.');
    }
}

test('reserved promo redemption survives admin edits and retry is idempotent', async () => {
    const connection = new FakePromoConnection();
    const redemption = {
        reservationToken: 'TOKEN-1', reference: 'PAY-1', orderId: 9,
        promoId: 7, promoCode: 'SAVE', discountInKobo: 1000, subtotalInKobo: 10000
    };
    await redeemPromoUsage(connection, redemption);
    assert.equal(connection.status, 'redeemed');
    assert.equal(connection.insertCount, 1);

    await redeemPromoUsage(connection, redemption);
    assert.equal(connection.insertCount, 1);
});
