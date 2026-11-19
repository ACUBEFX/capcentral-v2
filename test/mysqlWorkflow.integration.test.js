'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const {
    splitSqlStatements,
    validateSchemaStatements,
    collectExpectedIndexes,
    verifyInstalledSchema
} = require('../scripts/initializeStagingDatabase');

const enabled = process.env.CONFIRM_CAPCENTRAL_MYSQL_TESTS === 'true';
let db;
let database;
let databaseName;
let upgradeDatabaseName;
let upgradeDatabase;
let checkout;
let promoService;
let servicePaymentService;
let expiryService;
let paystackService;
let verifiedPayments;
let receiptSendCount = 0;

function makeReference(prefix) { return `${prefix}-${randomUUID()}`; }

async function createProduct({ price = 100, stock = 0, category = 'Shoes' } = {}) {
    const code = `IT-${randomUUID()}`;
    const [result] = await database.execute(
        `INSERT INTO products (product_code, name, price, stock_quantity, category, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [code, `Integration ${code}`, price, stock, category]
    );
    return { id: result.insertId, code, name: `Integration ${code}`, price, category };
}

async function createPromo({ code, limit = 5, type = 'fixed', value = 10 } = {}) {
    const promoCode = code || `IT-${randomUUID()}`;
    const [result] = await database.execute(
        `INSERT INTO promo_codes
            (code, discount_type, discount_value, min_order_amount, usage_limit, usage_count, is_active)
         VALUES (?, ?, ?, 0, ?, 0, 1)`,
        [promoCode, type, value, limit]
    );
    return { id: result.insertId, code: promoCode };
}

async function createReservedProductAttempt({ product, reference, token, amount, promoId = null, expiresInMinutes = -10 }) {
    await database.execute(
        `INSERT INTO inventory_reservations
            (reservation_token, paystack_reference, product_id, variant_id, quantity, status, expires_at)
         VALUES (?, ?, ?, NULL, 1, 'reserved', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
        [token, reference, product.id, expiresInMinutes]
    );
    await database.execute(
        `INSERT INTO payment_initialization_attempts
            (reservation_token, paystack_reference, initialization_status, expected_amount, currency)
         VALUES (?, ?, 'initialized', ?, 'NGN')`,
        [token, reference, amount]
    );
    if (promoId) {
        await database.execute(
            `INSERT INTO promo_usage_reservations
                (promo_code_id, reservation_token, paystack_reference, status, expires_at)
             VALUES (?, ?, ?, 'reserved', DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
            [promoId, token, reference]
        );
    }
}

function productMetadata(product, token, extras = {}) {
    return {
        reservationToken: token,
        cart: [{ productId: product.id, variantId: null, name: product.name, category: product.category, price: product.price, quantity: 1 }],
        email: 'integration@example.test', customerName: 'Integration Customer',
        customerPhone: '08000000000', deliveryOption: 'standard', expressSurcharge: 0,
        ...extras
    };
}

function paymentData(reference, amount, metadata, status = 'success') {
    return {
        id: `tx-${randomUUID()}`, reference, amount, currency: 'NGN', status,
        customer: { email: 'integration@example.test', first_name: 'Integration', last_name: 'Customer' },
        channel: 'card', gateway_response: 'Approved', metadata
    };
}

if (!enabled) {
    test('MySQL workflow integration suite requires explicit local database confirmation', { skip: 'Set CONFIRM_CAPCENTRAL_MYSQL_TESTS=true and a new CAPCENTRAL_MYSQL_TEST_DB name.' }, () => {});
} else {
    test('real MySQL service, checkout, promo, expiry and idempotency workflows', async t => {
        const env = require('dotenv').config().parsed || {};
        const host = String(process.env.DB_HOST || env.DB_HOST || 'localhost').toLowerCase();
        assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'MySQL integration tests only allow loopback DB_HOST.');
        databaseName = String(process.env.CAPCENTRAL_MYSQL_TEST_DB || '');
        assert.match(databaseName, /^capcentral_test_[a-z0-9_]{8,50}$/);
        assert.ok(databaseName.length <= 54, 'Test database name must leave room for the upgrade-test suffix.');
        upgradeDatabaseName = `${databaseName}_upgrade`;
        const configuredDb = String(process.env.DB_NAME || env.DB_NAME || 'Cap-Central');
        assert.notEqual(databaseName.toLowerCase(), configuredDb.toLowerCase(), 'Test database must differ from DB_NAME.');

        const connectionConfig = {
            host,
            port: Number(process.env.DB_PORT || env.DB_PORT || 3306),
            user: process.env.DB_USER || env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || env.DB_PASSWORD,
            connectTimeout: 10000
        };
        const serverConnection = await mysql.createConnection(connectionConfig);
        try {
            const [server] = await serverConnection.query('SELECT VERSION() AS version');
            assert.match(String(server[0].version), /^8\./, 'MySQL 8 is required for functional indexes.');
            const [exists] = await serverConnection.execute(
                'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?, ?)',
                [databaseName, upgradeDatabaseName]
            );
            assert.equal(exists.length, 0, 'Refusing to use an existing integration database. Choose new unique names.');
            await serverConnection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            await serverConnection.query(`CREATE DATABASE \`${upgradeDatabaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        } finally {
            await serverConnection.end();
        }

        process.env.DB_NAME = databaseName;
        const schemaSql = await fs.readFile(path.join(__dirname, '..', 'db', 'fresh-install.sql'), 'utf8');
        const statements = splitSqlStatements(schemaSql);
        validateSchemaStatements(statements);
        database = await mysql.createConnection({ ...connectionConfig, database: databaseName });
        upgradeDatabase = await mysql.createConnection({ ...connectionConfig, database: upgradeDatabaseName });
        t.after(async () => {
            if (db) await db.promise().end();
            if (database) await database.end();
            if (upgradeDatabase) await upgradeDatabase.end();
            // The isolated database is intentionally retained for inspection.
        });
        for (const statement of statements) await database.query(statement);
        const installed = await verifyInstalledSchema(
            database,
            databaseName,
            collectExpectedIndexes(statements)
        );
        assert.equal(installed.tableCount, 20);
        assert.equal(installed.foreignKeyCount, 14);

        const baselineStatements = statements
            .filter(statement => !/^CREATE TABLE `service_payment_attempts`/i.test(statement))
            .map(statement => statement.startsWith('CREATE TABLE `capcentral_receipt_emails`')
                ? statement.replace(/\s*`lease_token` CHAR\(36\) DEFAULT NULL,\r?\n/, '\n')
                : statement);
        assert.equal(baselineStatements.length, 19);
        for (const statement of baselineStatements) await upgradeDatabase.query(statement);
        const migrationFixtureReference = makeReference('IT-MIGRATION');
        await upgradeDatabase.execute(
            `INSERT INTO cap_services
                (reference_id,name,service_type,email,phone,caps_count,total_cost,schedule_date,delivery_option)
             VALUES (?,'Migration Fixture','resizing','migration@example.test','08000000000',1,3000,'2026-12-10','self-drop')`,
            [migrationFixtureReference]
        );
        await upgradeDatabase.execute(
            `INSERT INTO capcentral_receipt_emails (reference,status) VALUES (?,'sent')`,
            [migrationFixtureReference]
        );
        const [engines] = await database.execute(
            `SELECT COUNT(*) AS total, SUM(ENGINE = 'InnoDB') AS innodb
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [databaseName]
        );
        assert.equal(Number(engines[0].total), 20);
        assert.equal(Number(engines[0].innodb), 20);
        const [freshForeignKeys] = await database.execute(
            'SELECT COUNT(*) AS count FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
            [databaseName]
        );
        assert.equal(Number(freshForeignKeys[0].count), 14);
        const [leaseColumn] = await database.execute(
            `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'capcentral_receipt_emails' AND COLUMN_NAME = 'lease_token'`,
            [databaseName]
        );
        assert.equal(String(leaseColumn[0]?.COLUMN_TYPE).toLowerCase(), 'char(36)');

        const mailer = require('../utils/mailer');
        mailer.sendProductPaymentConfirmationEmail = async () => { receiptSendCount += 1; };
        mailer.sendPaymentConfirmationEmail = async () => { receiptSendCount += 1; };
        db = require('../models/database');
        promoService = require('../services/promoService');
        servicePaymentService = require('../services/servicePaymentService');
        checkout = require('../controllers/checkoutController');
        paystackService = require('../services/paystackService');
        verifiedPayments = new Map();
        paystackService.verifyTransaction = async reference => {
            const result = verifiedPayments.get(reference);
            if (!result) throw new Error('Mock Paystack reference not found.');
            return result;
        };
        expiryService = require('../services/reservationExpiryService');

        await t.test('migrations 008 and 009 upgrade an existing baseline without changing history', async () => {
            const migration008 = await fs.readFile(path.join(__dirname, '..', 'db', 'migrations', '008_service_payment_attempts.sql'), 'utf8');
            const migration009 = await fs.readFile(path.join(__dirname, '..', 'db', 'migrations', '009_receipt_delivery_lease.sql'), 'utf8');
            for (const statement of [...splitSqlStatements(migration008), ...splitSqlStatements(migration009)]) {
                await upgradeDatabase.query(statement);
            }
            const [serviceRows] = await upgradeDatabase.execute(
                'SELECT COUNT(*) AS count FROM cap_services WHERE reference_id = ?',
                [migrationFixtureReference]
            );
            const [receiptRows] = await upgradeDatabase.execute(
                'SELECT status, lease_token FROM capcentral_receipt_emails WHERE reference = ?',
                [migrationFixtureReference]
            );
            const [attemptTable] = await upgradeDatabase.execute(
                `SELECT COUNT(*) AS count FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'service_payment_attempts'`,
                [upgradeDatabaseName]
            );
            assert.equal(Number(serviceRows[0].count), 1);
            assert.equal(receiptRows[0].status, 'sent');
            assert.equal(receiptRows[0].lease_token, null);
            assert.equal(Number(attemptTable[0].count), 1);
        });

        await t.test('promo usage limit remains correct under concurrent transactions', async () => {
            const promo = await createPromo({ limit: 1 });
            const calls = [0, 1].map(index => promoService.reservePromoUsage(
                promo.code, 10000, `token-${randomUUID()}`, null, `ref-${index}-${randomUUID()}`
            ));
            const outcomes = await Promise.allSettled(calls);
            assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
            const [rows] = await database.execute(
                `SELECT COUNT(*) AS count FROM promo_usage_reservations WHERE promo_code_id = ? AND status = 'reserved'`,
                [promo.id]
            );
            assert.equal(Number(rows[0].count), 1);
        });

        await t.test('inventory row locks prevent concurrent overselling', async () => {
            const product = await createProduct({ price: 30, stock: 1 });
            const calls = [0, 1].map(() => checkout.reserveInventory(
                `token-${randomUUID()}`,
                [{ productId: product.id, quantity: 1 }],
                null,
                makeReference('IT-RESERVE')
            ));
            const outcomes = await Promise.allSettled(calls);
            assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
            const [stock] = await database.execute('SELECT stock_quantity FROM products WHERE id = ?', [product.id]);
            const [reservations] = await database.execute('SELECT COUNT(*) AS count FROM inventory_reservations WHERE product_id = ?', [product.id]);
            assert.equal(Number(stock[0].stock_quantity), 0);
            assert.equal(Number(reservations[0].count), 1);
        });

        await t.test('service attempt binds details, amount and email and retries idempotently', async () => {
            const idempotencyKey = randomUUID();
            const formData = {
                name: 'Integration Customer', email: 'integration@example.test', phone: '08000000000',
                capsCount: '2', capSize: '22', scheduleDate: '2026-12-10', deliveryOption: 'self-drop'
            };
            const first = await servicePaymentService.createOrGetAttempt({ idempotencyKey, serviceType: 'resizing', formData });
            let initializeCount = 0;
            const initialized = await servicePaymentService.startInitialization(first.attempt.reference, async attempt => {
                initializeCount += 1;
                assert.equal(attempt.expected_amount, 600000);
                return { reference: attempt.reference, authorization_url: 'https://checkout.invalid/test-only' };
            });
            const retry = await servicePaymentService.createOrGetAttempt({ idempotencyKey, serviceType: 'resizing', formData });
            assert.equal(retry.attempt.reference, first.attempt.reference);
            const retryInit = await servicePaymentService.startInitialization(first.attempt.reference, async () => {
                initializeCount += 1;
            });
            assert.equal(retryInit.authorization_url, initialized.authorization_url);
            assert.equal(initializeCount, 1);
            await assert.rejects(servicePaymentService.createOrGetAttempt({
                idempotencyKey, serviceType: 'resizing',
                formData: { ...formData, capsCount: '3' }
            }), /already used for different service details/);

            const validTx = {
                reference: first.attempt.reference, amount: 600000, currency: 'NGN', status: 'success',
                customer: { email: 'integration@example.test' },
                metadata: { paymentType: 'service', servicePaymentReference: first.attempt.reference }
            };
            for (const badTx of [
                { ...validTx, amount: 1 },
                { ...validTx, customer: { email: 'other@example.test' } },
                { ...validTx, metadata: { paymentType: 'service', servicePaymentReference: 'wrong' } }
            ]) {
                await assert.rejects(servicePaymentService.processVerifiedPayment(first.attempt.reference, badTx));
            }
            assert.equal(await servicePaymentService.processVerifiedPayment(first.attempt.reference, validTx).then(x => x.status), 'success');
            assert.equal(await servicePaymentService.processVerifiedPayment(first.attempt.reference, validTx).then(x => x.status), 'success');
            const [services] = await database.execute('SELECT COUNT(*) AS count FROM cap_services WHERE reference_id = ?', [first.attempt.reference]);
            assert.equal(Number(services[0].count), 1);
            const receipt = require('../services/receiptDelivery');
            assert.equal(await receipt.sendReceiptOnce(first.attempt.reference, async () => {}, db.promise()), true);
        });

        await t.test('service recovery worker verifies stale attempts and retries receipts once', async () => {
            const idempotencyKey = randomUUID();
            const formData = {
                name: 'Recovery Customer', email: 'recovery@example.test', phone: '08000000001',
                laundryCapsCount: '1', cleaningType: 'deep', laundryScheduleDate: '2026-12-11',
                laundryDeliveryOption: 'pickup'
            };
            const prepared = await servicePaymentService.createOrGetAttempt({
                idempotencyKey, serviceType: 'laundry', formData
            });
            await servicePaymentService.startInitialization(prepared.attempt.reference, async attempt => ({
                reference: attempt.reference, authorization_url: 'https://checkout.invalid/recovery-test'
            }));
            await database.execute(
                `UPDATE service_payment_attempts SET updated_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                 WHERE reference = ?`, [prepared.attempt.reference]
            );
            verifiedPayments.set(prepared.attempt.reference, {
                reference: prepared.attempt.reference,
                amount: 250000, currency: 'NGN', status: 'success',
                id: `tx-${randomUUID()}`,
                customer: { email: 'recovery@example.test' },
                metadata: { paymentType: 'service', servicePaymentReference: prepared.attempt.reference }
            });

            let receiptDeliveries = 0;
            const receipt = require('../services/receiptDelivery');
            const recovered = await servicePaymentService.recoverStalePayments({
                database: db.promise(),
                onSuccess: reference => receipt.sendReceiptOnce(reference, async () => { receiptDeliveries += 1; }, db.promise())
            });
            assert.ok(recovered.includes('success'));
            const [attemptRows] = await database.execute(
                'SELECT initialization_status FROM service_payment_attempts WHERE reference = ?',
                [prepared.attempt.reference]
            );
            const [serviceRows] = await database.execute(
                'SELECT COUNT(*) AS count FROM cap_services WHERE reference_id = ?',
                [prepared.attempt.reference]
            );
            assert.equal(attemptRows[0].initialization_status, 'paid');
            assert.equal(Number(serviceRows[0].count), 1);
            assert.equal(receiptDeliveries, 1);
            await servicePaymentService.recoverStalePayments({
                database: db.promise(),
                onSuccess: reference => receipt.sendReceiptOnce(reference, async () => { receiptDeliveries += 1; }, db.promise())
            });
            assert.equal(receiptDeliveries, 1);
        });

        await t.test('duplicate callback and webhook completion creates one order, payment, redemption and receipt', async () => {
            const product = await createProduct({ price: 100, stock: 0 });
            const promo = await createPromo({ limit: 4, value: 10 });
            const token = `token-${randomUUID()}`;
            const reference = makeReference('IT-PAY');
            await promoService.reservePromoUsage(promo.code, 10000, token, null, reference);
            await createReservedProductAttempt({ product, reference, token, amount: 9000 });
            const metadata = productMetadata(product, token, {
                promoId: promo.id, promoCode: promo.code, promoDiscountInKobo: 1000
            });
            const transaction = paymentData(reference, 9000, metadata);

            const duplicateDelivery = async () => {
                await checkout.associateVerifiedPayment(transaction, reference, metadata);
                await checkout.processVerifiedSuccessfulPayment(transaction, metadata);
            };
            const results = await Promise.allSettled([duplicateDelivery(), duplicateDelivery()]);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 2, JSON.stringify(results.map(result => result.reason?.code || result.reason?.message)));
            const [orders] = await database.execute('SELECT COUNT(*) AS count FROM orders WHERE order_reference = ?', [reference]);
            const [payments] = await database.execute('SELECT COUNT(*) AS count FROM payments WHERE paystack_reference = ?', [reference]);
            const [items] = await database.execute('SELECT COUNT(*) AS count FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.order_reference = ?', [reference]);
            const [redemptions] = await database.execute('SELECT COUNT(*) AS count FROM promo_redemptions WHERE paystack_reference = ?', [reference]);
            const [promoRows] = await database.execute('SELECT usage_count FROM promo_codes WHERE id = ?', [promo.id]);
            assert.deepEqual([Number(orders[0].count), Number(payments[0].count), Number(items[0].count), Number(redemptions[0].count), Number(promoRows[0].usage_count)], [1, 1, 1, 1, 1]);
            const [reservation] = await database.execute('SELECT status FROM inventory_reservations WHERE reservation_token = ?', [token]);
            assert.equal(reservation[0].status, 'paid');
            await checkout.releaseReservationForRecovery(token, reference, 'verified');
            const [stock] = await database.execute('SELECT stock_quantity FROM products WHERE id = ?', [product.id]);
            assert.equal(Number(stock[0].stock_quantity), 0, 'successful payment stock must not be restored');
            assert.equal(receiptSendCount, 1, 'duplicate completion must send one receipt');
        });

        await t.test('concurrent failed-payment releases restore stock only once and release promo usage', async () => {
            const product = await createProduct({ price: 50, stock: 0 });
            const promo = await createPromo({ limit: 3 });
            const token = `token-${randomUUID()}`;
            const reference = makeReference('IT-FAIL');
            await database.execute(
                `INSERT INTO inventory_reservations (reservation_token,paystack_reference,product_id,quantity,status,expires_at)
                 VALUES (?,?,?,1,'reserved',DATE_SUB(NOW(),INTERVAL 15 MINUTE))`,
                [token, reference, product.id]
            );
            await database.execute(
                `INSERT INTO payment_initialization_attempts (reservation_token,paystack_reference,initialization_status,expected_amount,currency)
                 VALUES (?,?,'initialized',5000,'NGN')`, [token, reference]
            );
            await database.execute(
                `INSERT INTO promo_usage_reservations (promo_code_id,reservation_token,paystack_reference,status,expires_at)
                 VALUES (?,?,?,'reserved',DATE_ADD(NOW(),INTERVAL 30 MINUTE))`, [promo.id, token, reference]
            );
            await Promise.all([
                checkout.releaseReservationForRecovery(token, reference, 'verified'),
                checkout.releaseReservationForRecovery(token, reference, 'verified')
            ]);
            const [stock] = await database.execute('SELECT stock_quantity FROM products WHERE id = ?', [product.id]);
            const [reservation] = await database.execute('SELECT status FROM inventory_reservations WHERE reservation_token = ?', [token]);
            const [promoReservation] = await database.execute('SELECT status FROM promo_usage_reservations WHERE reservation_token = ?', [token]);
            assert.equal(Number(stock[0].stock_quantity), 1);
            assert.equal(reservation[0].status, 'expired');
            assert.equal(promoReservation[0].status, 'released');
        });

        await t.test('expiry worker preserves pending payments and recovers verified success and failure', async () => {
            const pendingProduct = await createProduct({ price: 70, stock: 0 });
            const pendingToken = `token-${randomUUID()}`;
            const pendingRef = makeReference('IT-PENDING');
            await createReservedProductAttempt({ product: pendingProduct, reference: pendingRef, token: pendingToken, amount: 7000 });
            verifiedPayments.set(pendingRef, paymentData(pendingRef, 7000, { reservationToken: pendingToken }, 'pending'));

            const successProduct = await createProduct({ price: 80, stock: 0 });
            const successToken = `token-${randomUUID()}`;
            const successRef = makeReference('IT-RECOVER');
            await createReservedProductAttempt({ product: successProduct, reference: successRef, token: successToken, amount: 8000 });
            const successMetadata = productMetadata(successProduct, successToken);
            verifiedPayments.set(successRef, paymentData(successRef, 8000, successMetadata));

            const failedProduct = await createProduct({ price: 90, stock: 0 });
            const failedToken = `token-${randomUUID()}`;
            const failedRef = makeReference('IT-ABANDON');
            await createReservedProductAttempt({ product: failedProduct, reference: failedRef, token: failedToken, amount: 9000 });
            verifiedPayments.set(failedRef, paymentData(failedRef, 9000, { reservationToken: failedToken }, 'abandoned'));

            await expiryService.runExpiryCheck();
            const [pending] = await database.execute('SELECT status FROM inventory_reservations WHERE reservation_token = ?', [pendingToken]);
            const [pendingStock] = await database.execute('SELECT stock_quantity FROM products WHERE id = ?', [pendingProduct.id]);
            assert.equal(pending[0].status, 'reserved');
            assert.equal(Number(pendingStock[0].stock_quantity), 0);

            const [recovered] = await database.execute('SELECT status FROM inventory_reservations WHERE reservation_token = ?', [successToken]);
            const [recoveredOrders] = await database.execute('SELECT COUNT(*) AS count FROM orders WHERE order_reference = ?', [successRef]);
            const [recoveredStock] = await database.execute('SELECT stock_quantity FROM products WHERE id = ?', [successProduct.id]);
            assert.equal(recovered[0].status, 'paid');
            assert.equal(Number(recoveredOrders[0].count), 1);
            assert.equal(Number(recoveredStock[0].stock_quantity), 0);

            const [failed] = await database.execute('SELECT status FROM inventory_reservations WHERE reservation_token = ?', [failedToken]);
            const [failedStock] = await database.execute('SELECT stock_quantity FROM products WHERE id = ?', [failedProduct.id]);
            assert.equal(failed[0].status, 'expired');
            assert.equal(Number(failedStock[0].stock_quantity), 1);
        });
    });
}
