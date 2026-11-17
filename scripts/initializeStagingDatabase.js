'use strict';

/*
 * One-time initializer for a newly provisioned, empty staging database.
 *
 * Required environment: CONFIRM_STAGING_DB_INIT=true, Railway's
 * RAILWAY_ENVIRONMENT_NAME=staging, DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME.
 * DB_PORT is optional and defaults to 3306.
 * Credentials must be supplied through the environment or Railway variables;
 * never put them in this file or in a command-line argument.
 *
 * The script executes only the 19 CREATE TABLE statements in
 * db/fresh-install.sql. MySQL DDL is not rolled back as one transaction. If
 * installation fails, the script stops at and prints the exact statement;
 * inspect the database manually and do not rerun blindly. A subsequent run
 * will refuse the now non-empty database.
 *
 * Example inside the deployed Railway staging application service:
 * railway ssh --service <APP_SERVICE> --environment staging -- sh -lc \
 *   'CONFIRM_STAGING_DB_INIT=true node scripts/initializeStagingDatabase.js'
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const EXPECTED_TABLES = [
    'signup',
    'categories',
    'products',
    'product_variants',
    'cap_services',
    'orders',
    'order_items',
    'payments',
    'inventory_reservations',
    'promo_codes',
    'promo_usage_reservations',
    'promo_redemptions',
    'payment_initialization_attempts',
    'processed_cap_payments',
    'capcentral_receipt_emails',
    'deliveries',
    'order_requests',
    'stock_movements',
    'admin_audit_logs'
];

const EXPECTED_FOREIGN_KEYS = [
    ['fk_product_variants_product', 'product_variants', 'product_id', 'products', 'id'],
    ['fk_orders_user', 'orders', 'user_id', 'signup', 'id'],
    ['fk_order_items_order', 'order_items', 'order_id', 'orders', 'id'],
    ['fk_order_items_variant', 'order_items', 'variant_id', 'product_variants', 'id'],
    ['fk_payments_order', 'payments', 'order_id', 'orders', 'id'],
    ['fk_reservation_product', 'inventory_reservations', 'product_id', 'products', 'id'],
    ['fk_reservation_variant', 'inventory_reservations', 'variant_id', 'product_variants', 'id'],
    ['fk_promo_usage_code', 'promo_usage_reservations', 'promo_code_id', 'promo_codes', 'id'],
    ['fk_promo_redemption_code', 'promo_redemptions', 'promo_code_id', 'promo_codes', 'id'],
    ['fk_promo_redemption_order', 'promo_redemptions', 'order_id', 'orders', 'id'],
    ['fk_deliveries_order', 'deliveries', 'order_id', 'orders', 'id'],
    ['fk_order_requests_order', 'order_requests', 'order_id', 'orders', 'id'],
    ['fk_order_requests_user', 'order_requests', 'user_id', 'signup', 'id'],
    ['fk_stock_variant', 'stock_movements', 'variant_id', 'product_variants', 'id']
];

class SafeFailure extends Error {
    constructor(message) {
        super(message);
        this.name = 'SafeFailure';
    }
}

function readConfiguration(env = process.env) {
    if (env.CONFIRM_STAGING_DB_INIT !== 'true') {
        throw new SafeFailure(
            'Refusing initialization: set CONFIRM_STAGING_DB_INIT=true explicitly.'
        );
    }

    if (String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() !== 'staging') {
        throw new SafeFailure(
            'Refusing initialization: Railway environment must be named staging.'
        );
    }

    const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missing = required.filter(name => !String(env[name] || '').trim());
    if (missing.length) {
        throw new SafeFailure(`Missing required environment variables: ${missing.join(', ')}.`);
    }

    const database = String(env.DB_NAME).trim();
    if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(database.toLowerCase())) {
        throw new SafeFailure('Refusing to target a MySQL system database.');
    }

    const portText = String(env.DB_PORT || '3306').trim();
    if (!/^\d+$/.test(portText)) {
        throw new SafeFailure('DB_PORT must be an integer from 1 through 65535.');
    }

    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new SafeFailure('DB_PORT must be an integer from 1 through 65535.');
    }

    return {
        host: String(env.DB_HOST).trim(),
        user: String(env.DB_USER).trim(),
        password: String(env.DB_PASSWORD),
        database,
        port
    };
}

function splitSqlStatements(sql) {
    const statements = [];
    let statement = '';
    let state = 'normal';

    for (let index = 0; index < sql.length; index += 1) {
        const current = sql[index];
        const next = sql[index + 1];

        if (state === 'line-comment') {
            if (current === '\n') {
                statement += '\n';
                state = 'normal';
            }
            continue;
        }

        if (state === 'block-comment') {
            if (current === '*' && next === '/') {
                index += 1;
                state = 'normal';
            }
            continue;
        }

        if (state === 'single-quote' || state === 'double-quote' || state === 'backtick') {
            statement += current;

            if (current === '\\' && next !== undefined) {
                statement += next;
                index += 1;
                continue;
            }

            const terminator = state === 'single-quote'
                ? "'"
                : state === 'double-quote'
                    ? '"'
                    : '`';

            if (current === terminator) {
                if (next === terminator) {
                    statement += next;
                    index += 1;
                } else {
                    state = 'normal';
                }
            }
            continue;
        }

        if (current === '-' && next === '-' && (index + 2 === sql.length || /\s/.test(sql[index + 2]))) {
            state = 'line-comment';
            index += 1;
            continue;
        }

        if (current === '#') {
            state = 'line-comment';
            continue;
        }

        if (current === '/' && next === '*') {
            state = 'block-comment';
            index += 1;
            continue;
        }

        if (current === "'") {
            state = 'single-quote';
            statement += current;
            continue;
        }

        if (current === '"') {
            state = 'double-quote';
            statement += current;
            continue;
        }

        if (current === '`') {
            state = 'backtick';
            statement += current;
            continue;
        }

        if (current === ';') {
            const completed = statement.trim();
            if (completed) statements.push(completed);
            statement = '';
            continue;
        }

        statement += current;
    }

    if (state !== 'normal' && state !== 'line-comment') {
        throw new SafeFailure('The schema file contains an unterminated SQL quote or comment.');
    }

    const trailing = statement.trim();
    if (trailing) statements.push(trailing);
    return statements;
}

function validateSchemaStatements(statements) {
    const names = [];

    for (const statement of statements) {
        const match = statement.match(/^CREATE\s+TABLE\s+`([^`]+)`\s*\(/i);
        if (!match) {
            throw new SafeFailure(
                'The schema contains a statement other than a plain CREATE TABLE; refusing to execute it.'
            );
        }
        names.push(match[1]);
    }

    if (names.length !== EXPECTED_TABLES.length) {
        throw new SafeFailure(
            `Expected ${EXPECTED_TABLES.length} CREATE TABLE statements; found ${names.length}.`
        );
    }

    if (names.some((name, index) => name !== EXPECTED_TABLES[index])) {
        throw new SafeFailure('Schema table names or order differ from the reviewed fresh-install schema.');
    }

    return names;
}

function collectExpectedIndexes(statements) {
    const indexes = [];

    for (const statement of statements) {
        const tableMatch = statement.match(/^CREATE\s+TABLE\s+`([^`]+)`/i);
        const table = tableMatch?.[1];
        if (!table) throw new SafeFailure('Unable to identify a table while validating schema indexes.');

        for (const line of statement.split(/\r?\n/)) {
            if (/^\s*PRIMARY\s+KEY\s*\(/i.test(line)) {
                indexes.push({ table, name: 'PRIMARY', unique: true });
                continue;
            }

            const match = line.match(/^\s*(UNIQUE\s+)?KEY\s+`([^`]+)`/i);
            if (match) {
                indexes.push({ table, name: match[2], unique: Boolean(match[1]) });
            }
        }
    }

    return indexes;
}

function asForeignKeyKey(row) {
    return [
        row.CONSTRAINT_NAME,
        row.TABLE_NAME,
        row.COLUMN_NAME,
        row.REFERENCED_TABLE_NAME,
        row.REFERENCED_COLUMN_NAME
    ].join('|');
}

async function verifyInstalledSchema(connection, database, expectedIndexes) {
    const [tableRows] = await connection.execute(
        `SELECT TABLE_NAME, TABLE_TYPE, ENGINE
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?`,
        [database]
    );

    const actualTables = tableRows.map(row => row.TABLE_NAME).sort();
    const expectedTables = [...EXPECTED_TABLES].sort();
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
        throw new SafeFailure('Post-install table verification failed: table set differs from expected.');
    }

    const wrongEngine = tableRows.filter(row => row.TABLE_TYPE !== 'BASE TABLE' || row.ENGINE !== 'InnoDB');
    if (wrongEngine.length) {
        throw new SafeFailure(
            `Post-install engine verification failed for: ${wrongEngine.map(row => row.TABLE_NAME).join(', ')}.`
        );
    }

    const [foreignKeyRows] = await connection.execute(
        `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME,
                REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE CONSTRAINT_SCHEMA = ?
           AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [database]
    );

    const actualForeignKeys = foreignKeyRows.map(asForeignKeyKey).sort();
    const expectedForeignKeys = EXPECTED_FOREIGN_KEYS
        .map(parts => parts.join('|'))
        .sort();
    if (JSON.stringify(actualForeignKeys) !== JSON.stringify(expectedForeignKeys)) {
        throw new SafeFailure('Post-install foreign-key verification failed.');
    }

    const [indexRows] = await connection.execute(
        `SELECT TABLE_NAME, INDEX_NAME, MIN(NON_UNIQUE) AS NON_UNIQUE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ?
         GROUP BY TABLE_NAME, INDEX_NAME`,
        [database]
    );

    const actualIndexes = new Map(
        indexRows.map(row => [`${row.TABLE_NAME}|${row.INDEX_NAME}`, Number(row.NON_UNIQUE)])
    );

    const missingIndexes = expectedIndexes.filter(index => {
        const nonUnique = actualIndexes.get(`${index.table}|${index.name}`);
        return nonUnique === undefined || nonUnique !== (index.unique ? 0 : 1);
    });

    if (missingIndexes.length) {
        throw new SafeFailure(
            `Post-install index verification failed for: ${missingIndexes.map(i => `${i.table}.${i.name}`).join(', ')}.`
        );
    }

    return { tableCount: tableRows.length, foreignKeyCount: foreignKeyRows.length, indexCount: expectedIndexes.length };
}

async function main() {
    let connection;
    let statementFailureReported = false;

    try {
        const config = readConfiguration();
        const schemaPath = path.resolve(__dirname, '..', 'db', 'fresh-install.sql');
        const schemaSql = await fs.readFile(schemaPath, 'utf8');
        const statements = splitSqlStatements(schemaSql);
        validateSchemaStatements(statements);
        const expectedIndexes = collectExpectedIndexes(statements);

        connection = await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            connectTimeout: 10000,
            multipleStatements: false
        });

        const [serverRows] = await connection.execute(
            'SELECT VERSION() AS server_version, DATABASE() AS selected_database'
        );
        const serverVersion = String(serverRows[0]?.server_version || '');
        const selectedDatabase = String(serverRows[0]?.selected_database || '');

        if (/mariadb/i.test(serverVersion)) {
            throw new SafeFailure('This initializer requires MySQL 8.0.13 or newer; MariaDB is not supported.');
        }

        const versionMatch = serverVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!versionMatch) {
            throw new SafeFailure('Unable to parse the MySQL server version; refusing installation.');
        }

        const version = versionMatch.slice(1).map(Number);
        const isAtLeastRequired = version[0] > 8 ||
            (version[0] === 8 && version[1] > 0) ||
            (version[0] === 8 && version[1] === 0 && version[2] >= 13);
        if (!isAtLeastRequired) {
            throw new SafeFailure(`MySQL ${serverVersion} is too old; MySQL 8.0.13 or newer is required.`);
        }

        if (selectedDatabase !== config.database) {
            throw new SafeFailure('Connected database does not exactly match DB_NAME; refusing installation.');
        }

        const [existingObjects] = await connection.execute(
            `SELECT TABLE_NAME, TABLE_TYPE
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?
             LIMIT 1`,
            [config.database]
        );
        if (existingObjects.length) {
            const object = existingObjects[0];
            throw new SafeFailure(
                `Refusing installation: target database is not empty (found ${object.TABLE_TYPE.toLowerCase()} "${object.TABLE_NAME}").`
            );
        }

        console.log(
            `Validated MySQL ${serverVersion}; target database "${config.database}" is empty. Installing ${statements.length} tables.`
        );

        for (let index = 0; index < statements.length; index += 1) {
            try {
                await connection.query(statements[index]);
            } catch (error) {
                statementFailureReported = true;
                console.error(`Installation stopped at statement ${index + 1} (${error.code || 'MySQL error'}):`);
                console.error(statements[index]);
                throw new SafeFailure(
                    'A DDL statement failed. MySQL may have kept earlier tables; inspect the target manually and do not rerun blindly.'
                );
            }
        }

        const result = await verifyInstalledSchema(connection, config.database, expectedIndexes);
        console.log(
            `Installation verified: ${result.tableCount} InnoDB tables, ${result.foreignKeyCount} foreign keys, and ${result.indexCount} required indexes.`
        );
    } catch (error) {
        if (error instanceof SafeFailure) {
            console.error(error.message);
        } else {
            console.error(`Initializer stopped due to a database or local I/O error${error.code ? ` (${error.code})` : ''}.`);
            if (statementFailureReported) {
                console.error('Review the statement printed above and inspect the database before taking any further action.');
            }
        }
        process.exitCode = 1;
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (error) {
                console.error(`Could not close the database connection cleanly${error.code ? ` (${error.code})` : ''}.`);
                process.exitCode = 1;
            }
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    splitSqlStatements,
    validateSchemaStatements,
    collectExpectedIndexes
};
