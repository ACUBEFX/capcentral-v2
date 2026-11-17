
const db = require('../models/database');
const bcrypt = require('bcrypt');
const path = require('path');



const {
    sendOrderStatusUpdateEmail,
    sendDeliveryUpdateEmail
} = require('../utils/mailer');


// =====================================================
// ADMIN LOGIN PAGE
// =====================================================

exports.renderLogin = (req, res) => {
    res.sendFile(
        path.join(__dirname, '../public/admin-login.html')
    );
};


// =====================================================
// HANDLE ADMIN LOGIN
// =====================================================

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const sql = `
            SELECT id, username, email, password,
                   is_admin, is_verified, is_active
            FROM signup
            WHERE email = ?
        `;

        db.query(sql, [email], async (err, results) => {
            if (err) {
                console.error('Admin login database error:', err);
                return res.status(500).send('Unable to sign in.');
            }

            if (results.length === 0) {
                return res.status(401).send('Invalid email or password.');
            }

            const user = results[0];

            // Only administrator accounts may continue
            if (!user.is_admin) {
                return res.status(403).send(
                    'Access denied. This account is not an administrator.'
                );
            }

            if (user.is_active === 0) {
                return res.status(403).send('This account has been deactivated. Contact an administrator.');
            }

            if (!user.is_verified) {
                return res.status(403).send(
                    'Please verify your email before signing in.'
                );
            }

            const passwordMatches = await bcrypt.compare(
                password,
                user.password
            );

            if (!passwordMatches) {
                return res.status(401).send(
                    'Invalid email or password.'
                );
            }

            // Create a fresh session after successful authentication
            req.session.regenerate((sessionErr) => {
                if (sessionErr) {
                    console.error('Admin session error:', sessionErr);
                    return res.status(500).send('Unable to create session.');
                }

                req.session.user = {
                    id: user.id,
                    username: user.username,
                    email: user.email
                };

                req.session.save((saveErr) => {
                    if (saveErr) {
                        console.error('Admin session save error:', saveErr);
                        return res.status(500).send('Unable to save session.');
                    }

                    return res.redirect('/admin');
                });
            });
        });
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).send('Unable to sign in.');
    }
};

// =====================================================
// ADMIN DASHBOARD
// =====================================================



exports.dashboard = (req, res) => {
    const queries = {
        customers: 'SELECT COUNT(*) AS count FROM signup',
        orders: 'SELECT COUNT(*) AS count FROM orders',
        payments: "SELECT COUNT(*) AS count FROM payments WHERE payment_status = 'success'",
        services: 'SELECT COUNT(*) AS count FROM cap_services',
        revenue: "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_status = 'success'"
    };

    db.query(queries.customers, (err, customerResult) => {
        if (err) {
            console.error('Customers query error:', err);
            return res.status(500).send('Database error.');
        }

        db.query(queries.orders, (err, orderResult) => {
            if (err) {
                console.error('Orders query error:', err);
                return res.status(500).send('Database error.');
            }

            db.query(queries.payments, (err, paymentResult) => {
                if (err) {
                    console.error('Payments query error:', err);
                    return res.status(500).send('Database error.');
                }

                db.query(queries.services, (err, serviceResult) => {
                    if (err) {
                        console.error('Services query error:', err);
                        return res.status(500).send('Database error.');
                    }

                    db.query(queries.revenue, (err, revenueResult) => {
                        if (err) {
                            console.error('Revenue query error:', err);
                            return res.status(500).send('Database error.');
                        }

                        // Inventory alerts
                        const lowStockSql = `
                            SELECT
                                id,
                                product_code,
                                name,
                                category,
                                stock_quantity,
                                price
                            FROM products
                            WHERE is_active = 1
                              AND (
                                  (category = 'Caps' AND stock_quantity = 0)
                                  OR
                                  (category <> 'Caps' AND stock_quantity <= 5)
                              )
                            ORDER BY stock_quantity ASC, name ASC
                            LIMIT 8
                        `;

                        db.query(
                            lowStockSql,
                            (stockErr, lowStockProducts) => {
                                if (stockErr) {
                                    console.error(
                                        'Low-stock query error:',
                                        stockErr
                                    );
                                }

                                // Five most recent orders
                                const recentOrdersSql = `
                                    SELECT
                                        id,
                                        order_reference,
                                        customer_name,
                                        total_amount,
                                        currency,
                                        order_status,
                                        created_at
                                    FROM orders
                                    ORDER BY created_at DESC
                                    LIMIT 5
                                `;

                                db.query(
                                    recentOrdersSql,
                                    (ordersErr, recentOrders) => {
                                        if (ordersErr) {
                                            console.error(
                                                'Recent orders query error:',
                                                ordersErr
                                            );
                                        }

                                        return res.render(
                                            'admin/dashboard',
                                            {
                                                admin: req.admin,

                                                stats: {
                                                    customers:
                                                        customerResult[0].count,
                                                    orders:
                                                        orderResult[0].count,
                                                    payments:
                                                        paymentResult[0].count,
                                                    services:
                                                        serviceResult[0].count,
                                                    revenue:
                                                        revenueResult[0].total
                                                },

                                                lowStockProducts:
                                                    stockErr
                                                        ? []
                                                        : lowStockProducts,

                                                recentOrders:
                                                    ordersErr
                                                        ? []
                                                        : recentOrders
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    });
                });
            });
        });
    });
};



// =====================================================
// ADMIN ORDER / SERVICE STATUS UPDATES
// =====================================================

const STATUS_COLUMN_CANDIDATES = ['status', 'order_status', 'service_status'];
const COMMON_ORDER_STATUSES = ['pending', 'processing', 'completed', 'delivered', 'cancelled'];
const COMMON_SERVICE_STATUSES = ['pending', 'processing', 'completed', 'collected', 'cancelled'];

function parseEnumValues(columnType) {
    if (!columnType || !/^enum\(/i.test(columnType)) return [];
    const values = [];
    const re = /'((?:[^'\\]|\\.)*)'/g;
    let match;
    while ((match = re.exec(columnType)) !== null) {
        values.push(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    }
    return values;
}

async function getStatusMetadata(connection, table, commonStatuses) {
    const [columnInfo] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
    const primary = columnInfo.find(column => column.Key === 'PRI');
    const statusColumn = STATUS_COLUMN_CANDIDATES.find(name =>
        columnInfo.some(column => column.Field === name)
    );
    if (!primary || !statusColumn) {
        throw new Error(`The ${table} table must have a primary key and a status/order_status/service_status column.`);
    }

    const statusDefinition = columnInfo.find(column => column.Field === statusColumn);
    let allowedStatuses = parseEnumValues(statusDefinition.Type);
    if (!allowedStatuses.length) {
        const [existingRows] = await connection.query(
            `SELECT DISTINCT \`${statusColumn}\` AS status_value FROM \`${table}\` WHERE \`${statusColumn}\` IS NOT NULL`
        );
        allowedStatuses = [...new Set([
            ...existingRows.map(row => String(row.status_value)),
            ...commonStatuses
        ])];
    }
    return { primaryKey: primary.Field, statusColumn, allowedStatuses, columnInfo };
}

async function updateRecordStatus(req, res, { table, returnPath, commonStatuses }) {
    let connection;
    try {
        const id = String(req.params.id || '').trim();
        const requestedStatus = String(req.body.status || '').trim();
        if (!id || !requestedStatus) {
            return res.redirect(`${returnPath}?error=${encodeURIComponent('Choose a status before updating.')}`);
        }

        connection = await db.promise().getConnection();
        const meta = await getStatusMetadata(connection, table, commonStatuses);
        if (!meta.allowedStatuses.includes(requestedStatus)) {
            return res.redirect(`${returnPath}?error=${encodeURIComponent('That status is not allowed by the current database schema.')}`);
        }

        const [result] = await connection.query(
            `UPDATE \`${table}\` SET \`${meta.statusColumn}\` = ? WHERE \`${meta.primaryKey}\` = ?`,
            [requestedStatus, id]
        );
        if (!result.affectedRows) {
            return res.redirect(`${returnPath}?error=${encodeURIComponent('Record not found or status unchanged.')}`);
        }

        return res.redirect(`${returnPath}?message=${encodeURIComponent('Status updated successfully.')}`);
    } catch (error) {
        console.error(`Admin ${table} status update error:`, error);
        return res.redirect(`${returnPath}?error=${encodeURIComponent('Could not update status. Check the server console and database status column.')}`);
    } finally {
        if (connection) connection.release();
    }
}

exports.updateOrderStatus = (req, res) => updateRecordStatus(req, res, {
    table: 'orders',
    returnPath: '/admin/orders',
    commonStatuses: COMMON_ORDER_STATUSES
});

exports.updateServiceStatus = (req, res) => updateRecordStatus(req, res, {
    table: 'cap_services',
    returnPath: '/admin/services',
    commonStatuses: COMMON_SERVICE_STATUSES
});

exports.updateDeliveryStatus = (req, res) => updateRecordStatus(req, res, {
    table: 'orders',
    returnPath: '/admin/deliveries',
    commonStatuses: COMMON_ORDER_STATUSES
});

// =====================================================
// ADMIN DETAIL PAGES — show the records behind dashboard figures
// =====================================================

async function renderRecordTable(req, res, options) {
    const { table, title, description, whereSql = '', whereParams = [], revenueMode = false, editableStatus = false, commonStatuses = [], statusActionPath = null } = options;
    let connection;

    try {
        connection = await db.promise().getConnection();
        // Table names are supplied only by the fixed routes below, never by user input.
        const [columnInfo] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
        const columns = columnInfo.map(column => ({
            key: column.Field,
            label: String(column.Field).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
        }));

        const primary = columnInfo.find(column => column.Key === 'PRI');
        const sortColumn = primary?.Field || (columnInfo.some(c => c.Field === 'created_at') ? 'created_at' : null);
        const orderSql = sortColumn ? ` ORDER BY \`${sortColumn}\` DESC` : '';
        const [records] = await connection.query(
            `SELECT * FROM \`${table}\` ${whereSql}${orderSql}`,
            whereParams
        );

        let totalRevenue = null;
        if (revenueMode) {
            const [sumRows] = await connection.query(
                `SELECT COALESCE(SUM(amount), 0) AS total FROM \`${table}\` ${whereSql}`,
                whereParams
            );
            totalRevenue = Number(sumRows[0]?.total || 0);
        }

        let statusEditor = null;
        if (editableStatus) {
            const meta = await getStatusMetadata(connection, table, commonStatuses);
            statusEditor = {
                primaryKey: meta.primaryKey,
                statusColumn: meta.statusColumn,
                allowedStatuses: meta.allowedStatuses,
                actionPath: statusActionPath || (table === 'orders' ? '/admin/orders' : '/admin/services')
            };
        }

        res.render('admin/records', {
            admin: req.admin,
            title,
            description,
            columns,
            records,
            totalRevenue,
            statusEditor,
            message: req.query.message || '',
            queryError: req.query.error || '',
            error: null
        });
    } catch (error) {
        console.error(`Admin ${table} records error:`, error);
        res.status(500).render('admin/records', {
            admin: req.admin,
            title,
            description,
            columns: [],
            records: [],
            totalRevenue: null,
            statusEditor: null,
            message: '',
            queryError: '',
            error: `Could not load these records. Check that the ${table} table exists and matches your database. Details have been written to the server console.`
        });
    } finally {
        if (connection) connection.release();
    }
}

exports.orders = (req, res) => renderRecordTable(req, res, {
    table: 'orders',
    title: 'Total Orders',
    description: 'All order records currently saved in CapCentral. Use the status controls to update order progress.',
    editableStatus: true,
    commonStatuses: COMMON_ORDER_STATUSES
});

exports.payments = (req, res) => renderRecordTable(req, res, {
    table: 'payments',
    title: 'Successful Payments',
    description: 'Transactions marked successful in the database.',
    whereSql: "WHERE payment_status = 'success'"
});

exports.services = (req, res) => renderRecordTable(req, res, {
    table: 'cap_services',
    title: 'Cap Services — Service Records',
    description: 'All cap resizing and laundry service requests recorded in CapCentral. Use the status controls to update service progress.',
    editableStatus: true,
    commonStatuses: COMMON_SERVICE_STATUSES
});

exports.revenue = (req, res) => renderRecordTable(req, res, {
    table: 'payments',
    title: 'Recorded Revenue',
    description: 'Successful payment records included in the revenue total.',
    whereSql: "WHERE payment_status = 'success'",
    revenueMode: true
});


// =====================================================
// CUSTOMER MANAGEMENT — directory, details, edit, activate/deactivate, delete
// Requires signup.is_active (see db/customer_management.sql in the patch).
// =====================================================

function customerMessage(res, kind, message, destination = '/admin/customers') {
    return res.redirect(`${destination}?${kind}=${encodeURIComponent(message)}`);
}

exports.customers = async (req, res) => {
    let connection;
    const search = String(req.query.search || '').trim().slice(0, 120);
    const status = String(req.query.status || '').trim();
    try {
        connection = await db.promise().getConnection();
        const clauses = [];
        const params = [];
        if (search) {
            clauses.push('(username LIKE ? OR email LIKE ? OR phone_number LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        if (status === 'active') clauses.push('is_active = 1');
        if (status === 'inactive') clauses.push('is_active = 0');
        const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const [customers] = await connection.query(
            `SELECT id, username, email, phone_number, address, is_verified, is_active, created_at
             FROM signup ${whereSql} ORDER BY created_at DESC, id DESC LIMIT 500`,
            params
        );
        res.render('admin/customers', {
            admin: req.admin, customers, search, status,
            message: req.query.message || '', error: req.query.error || ''
        });
    } catch (error) {
        console.error('Admin customers page error:', error);
        res.status(500).render('admin/customers', {
            admin: req.admin, customers: [], search, status, message: '',
            error: 'Could not load customers. Confirm you ran db/customer_management.sql and check the server console.'
        });
    } finally {
        if (connection) connection.release();
    }
};

exports.customerDetails = async (req, res) => {
    let connection;
    try {
        connection = await db.promise().getConnection();
        const customerId = String(req.params.id || '').trim();
        const [customerRows] = await connection.query(
            `SELECT id, username, email, phone_number, address, is_verified, is_active, created_at, updated_at
             FROM signup WHERE id = ? LIMIT 1`, [customerId]
        );
        if (!customerRows.length) {
            connection.release(); connection = null;
            return customerMessage(res, 'error', 'Customer not found.');
        }
        const customer = customerRows[0];
        const [orderColumns] = await connection.query('SHOW COLUMNS FROM `orders`');
        const orderFields = new Set(orderColumns.map(column => column.Field));
        const orderMatch = [];
        const orderParams = [];
        if (orderFields.has('user_id')) { orderMatch.push('user_id = ?'); orderParams.push(customer.id); }
        if (orderFields.has('customer_email')) { orderMatch.push('customer_email = ?'); orderParams.push(customer.email); }
        const orders = orderMatch.length ? (await connection.query(
            `SELECT * FROM orders WHERE ${orderMatch.join(' OR ')} ORDER BY created_at DESC LIMIT 500`, orderParams
        ))[0] : [];

        const [serviceColumns] = await connection.query('SHOW COLUMNS FROM `cap_services`');
        const serviceFields = new Set(serviceColumns.map(column => column.Field));
        const serviceMatch = [];
        const serviceParams = [];
        if (serviceFields.has('email')) { serviceMatch.push('email = ?'); serviceParams.push(customer.email); }
        if (serviceFields.has('phone') && customer.phone_number) { serviceMatch.push('phone = ?'); serviceParams.push(customer.phone_number); }
        const services = serviceMatch.length ? (await connection.query(
            `SELECT * FROM cap_services WHERE ${serviceMatch.join(' OR ')} ORDER BY created_at DESC LIMIT 500`, serviceParams
        ))[0] : [];

        res.render('admin/customer-details', { admin: req.admin, customer, orders, services, message: req.query.message || '' });
    } catch (error) {
        console.error('Admin customer details error:', error);
        res.status(500).send('Could not load customer details. Check the server console.');
    } finally {
        if (connection) connection.release();
    }
};

exports.editCustomerForm = async (req, res) => {
    let connection;
    try {
        connection = await db.promise().getConnection();
        const [rows] = await connection.query(
            `SELECT id, username, email, phone_number, address, is_verified, is_active
             FROM signup WHERE id = ? LIMIT 1`, [req.params.id]
        );
        if (!rows.length) {
            connection.release(); connection = null;
            return customerMessage(res, 'error', 'Customer not found.');
        }
        res.render('admin/customer-edit', {
            admin: req.admin, customer: rows[0], error: req.query.error || ''
        });
    } catch (error) {
        console.error('Admin edit customer page error:', error);
        res.status(500).send('Could not open the customer edit page.');
    } finally {
        if (connection) connection.release();
    }
};

exports.updateCustomer = async (req, res) => {
    let connection;
    const id = String(req.params.id || '').trim();
    const username = String(req.body.username || '').trim().slice(0, 100);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 255);
    const phone = String(req.body.phone_number || '').trim().slice(0, 20);
    const address = String(req.body.address || '').trim().slice(0, 1000);
    if (!username || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        return customerMessage(res, 'error', 'Enter a username and valid email address.', `/admin/customers/${encodeURIComponent(id)}/edit`);
    }
    try {
        connection = await db.promise().getConnection();
        const [existing] = await connection.query(
            'SELECT id FROM signup WHERE email = ? AND id <> ? LIMIT 1', [email, id]
        );
        if (existing.length) {
            connection.release(); connection = null;
            return customerMessage(res, 'error', 'Another account already uses that email.', `/admin/customers/${encodeURIComponent(id)}/edit`);
        }
        const [result] = await connection.query(
            `UPDATE signup SET username = ?, email = ?, phone_number = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [username, email, phone || null, address || null, id]
        );
        if (!result.affectedRows) {
            // An unchanged row may report zero; verify it exists before treating it as missing.
            const [rows] = await connection.query('SELECT id FROM signup WHERE id = ? LIMIT 1', [id]);
            if (!rows.length) {
                connection.release(); connection = null;
                return customerMessage(res, 'error', 'Customer not found.');
            }
        }
        return customerMessage(res, 'message', 'Customer details updated successfully.', `/admin/customers/${encodeURIComponent(id)}`);
    } catch (error) {
        console.error('Admin update customer error:', error);
        return customerMessage(res, 'error', 'Could not update customer details. Check the server console.');
    } finally {
        if (connection) connection.release();
    }
};

exports.toggleCustomerActive = async (req, res) => {
    let connection;
    const id = String(req.params.id || '').trim();
    const active = String(req.body.active || '') === '1' ? 1 : 0;
    try {
        connection = await db.promise().getConnection();
        const [result] = await connection.query('UPDATE signup SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [active, id]);
        if (!result.affectedRows) {
            const [rows] = await connection.query('SELECT id FROM signup WHERE id = ? LIMIT 1', [id]);
            if (!rows.length) {
                connection.release(); connection = null;
                return customerMessage(res, 'error', 'Customer not found.');
            }
        }
        return customerMessage(res, 'message', active ? 'Customer account activated.' : 'Customer account deactivated.');
    } catch (error) {
        console.error('Admin activate/deactivate customer error:', error);
        return customerMessage(res, 'error', 'Could not change customer account status. Confirm the database migration was run.');
    } finally {
        if (connection) connection.release();
    }
};

exports.deleteCustomer = async (req, res) => {
    let connection;
    const id = String(req.params.id || '').trim();
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT id, email FROM signup WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
        if (!rows.length) {
            await connection.rollback();
            connection.release(); connection = null;
            return customerMessage(res, 'error', 'Customer not found.');
        }
        // Preserve historic orders, totals and status while removing the account relationship.
        const [orderColumns] = await connection.query('SHOW COLUMNS FROM `orders`');
        if (orderColumns.some(column => column.Field === 'user_id')) {
            await connection.query('UPDATE orders SET user_id = NULL WHERE user_id = ?', [id]);
        }
        await connection.query('DELETE FROM signup WHERE id = ?', [id]);
        await connection.commit();
        return customerMessage(res, 'message', 'Customer account deleted. Historical orders and service records were preserved.');
    } catch (error) {
        if (connection) { try { await connection.rollback(); } catch (_) {} }
        console.error('Admin delete customer error:', error);
        return customerMessage(res, 'error', 'Could not delete this customer. The account may be referenced by another table; deactivate it instead if needed.');
    } finally {
        if (connection) connection.release();
    }
};

// =====================================================
// DELIVERIES — use existing order statuses; no extra delivery table required
// =====================================================

exports.deliveries = async (req, res) => {
    let connection;
    try {
        connection = await db.promise().getConnection();
        const [orders] = await connection.query(`
            SELECT id, order_reference, customer_name, customer_email, customer_phone,
                   total_amount, currency, order_status, delivery_address, delivery_option,
                   tracking_number, dispatch_date, delivered_at, delivery_notes, created_at
            FROM orders
            WHERE order_status NOT IN ('cancelled', 'refunded')
            ORDER BY created_at DESC, id DESC
            LIMIT 500
        `);
        res.render('admin/deliveries', {
            admin: req.admin,
            orders,
            message: req.query.message || '',
            error: req.query.error || ''
        });
    } catch (error) {
        console.error('Admin deliveries page error:', error);
        res.status(500).send('Could not load deliveries. Confirm you ran db/delivery_management.sql and check the server console.');
    } finally {
        if (connection) connection.release();
    }
};

exports.updateDeliveryDetails = async (req, res) => {
    let connection;
    const id = String(req.params.id || '').trim();
    const trackingNumber = String(req.body.tracking_number || '').trim().slice(0, 100);
    const deliveryOption = String(req.body.delivery_option || 'standard').trim().toLowerCase();
    const allowedDeliveryOptions = ['standard', 'express'];
    const rawDispatch = String(req.body.dispatch_date || '').trim();
    const rawDelivered = String(req.body.delivered_at || '').trim();
    const notes = String(req.body.delivery_notes || '').trim().slice(0, 2000);
    const address = String(req.body.delivery_address || '').trim().slice(0, 2000);
    const dateValue = value => {
        if (!value) return null;
        const normalized = value.replace('T', ' ');
        return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
    };
    const dispatchDate = dateValue(rawDispatch);
    const deliveredAt = dateValue(rawDelivered);

    if (!id || !allowedDeliveryOptions.includes(deliveryOption)) {
        return res.redirect('/admin/deliveries?error=' + encodeURIComponent('Check the delivery details and try again.'));
    }
    try {
        connection = await db.promise().getConnection();
        const [result] = await connection.query(`
            UPDATE orders
            SET delivery_address = ?, delivery_option = ?, tracking_number = ?,
                dispatch_date = ?, delivered_at = ?, delivery_notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [address || null, deliveryOption, trackingNumber || null, dispatchDate, deliveredAt, notes || null, id]);
        if (!result.affectedRows) {
            const [found] = await connection.query('SELECT id FROM orders WHERE id = ? LIMIT 1', [id]);
            if (!found.length) {
                connection.release(); connection = null;
                return res.redirect('/admin/deliveries?error=' + encodeURIComponent('Order not found.'));
            }
        }
        return res.redirect('/admin/deliveries?message=' + encodeURIComponent('Delivery details saved.'));
    } catch (error) {
        console.error('Admin update delivery details error:', error);
        return res.redirect('/admin/deliveries?error=' + encodeURIComponent('Could not save delivery details. Check the database migration and server console.'));
    } finally {
        if (connection) connection.release();
    }
};


exports.customerDeliveries = async (req, res) => {
    let connection;

    try {
        const userId = Number(req.session.user?.id);

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.redirect('/login');
        }

        connection = await db.promise().getConnection();

        const [users] = await connection.query(
            'SELECT email FROM signup WHERE id = ? LIMIT 1',
            [userId]
        );

        if (!users.length) {
            return res.redirect('/login');
        }

        const email = users[0].email;

        const [orders] = await connection.query(`
            SELECT
                id,
                user_id,
                order_reference,
                customer_name,
                customer_email,
                subtotal,
                delivery_fee,
                express_surcharge,
                total_amount,
                currency,
                order_status,
                delivery_address,
                delivery_type,
                delivery_option,
                tracking_number,
                dispatch_date,
                delivered_date,
                delivered_at,
                delivery_notes,
                created_at,
                updated_at
            FROM orders
            WHERE user_id = ? OR customer_email = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 200
        `, [userId, email]);

        if (orders.length) {
            const orderIds = orders.map(order => order.id);

            const [items] = await connection.query(
                `SELECT *
                 FROM order_items
                 WHERE order_id IN (?)`,
                [orderIds]
            );

            orders.forEach(order => {
                order.items = items.filter(
                    item => Number(item.order_id) === Number(order.id)
                );
            });
        }

        const [requests] = await connection.query(`
            SELECT
                r.*,
                o.order_reference,
                o.total_amount,
                o.currency,
                o.order_status
            FROM order_requests r
            INNER JOIN orders o ON o.id = r.order_id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC, r.id DESC
        `, [userId]);

        return res.render('customer-deliveries', {
            orders,
            requests,
            user: req.session.user
        });

    } catch (error) {
        console.error('Customer delivery tracking error:', error);

        return res.status(500).send(
            'Could not load your delivery tracking. Please try again later.'
        );

    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// =====================================================
// ADMIN: VIEW CUSTOMER CANCELLATION AND REFUND REQUESTS
// =====================================================

exports.orderRequests = async (req, res) => {
    let connection;

    try {
        connection = await db.promise().getConnection();

        const [requests] = await connection.execute(`
            SELECT
                r.id, r.order_id, r.user_id, r.request_type,
                r.reason, r.request_status, r.admin_note,
                r.reviewed_at, r.created_at,
                o.order_reference, o.customer_name,
                o.customer_email, o.total_amount,
                o.currency, o.order_status,
                u.username
            FROM order_requests r
            INNER JOIN orders o ON o.id = r.order_id
            LEFT JOIN signup u ON u.id = r.user_id
            ORDER BY
                CASE WHEN r.request_status = 'pending' THEN 0 ELSE 1 END,
                r.created_at DESC
            LIMIT 500
        `);

        return res.render('admin/order-requests', {
            admin: req.admin,
            requests,
            message: req.query.message || '',
            error: req.query.error || ''
        });

    } catch (error) {
        console.error('Admin order requests error:', error);
        return res.status(500).send('Unable to load customer order requests.');
    } finally {
        if (connection) connection.release();
    }
};


// =====================================================
// ADMIN: APPROVE OR REJECT CUSTOMER REQUEST
// =====================================================

exports.reviewOrderRequest = async (req, res) => {
    let connection;
    let transactionStarted = false;

    const requestId = Number(req.params.id);
    const decision = String(req.body.decision || '').trim();
    const adminNote = String(req.body.admin_note || '').trim();
    const adminId = Number(req.session?.user?.id);

    const redirectError = message =>
        res.redirect('/admin/order-requests?error=' + encodeURIComponent(message));

    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
        return redirectError('Invalid request.');
    }

    if (!['approved', 'rejected'].includes(decision)) {
        return redirectError('Choose approve or reject.');
    }

    if (!Number.isSafeInteger(adminId) || adminId <= 0) {
        return res.status(403).send('Administrator session not found.');
    }

    if (adminNote.length > 2000) {
        return redirectError('Admin response cannot exceed 2,000 characters.');
    }

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [rows] = await connection.execute(`
            SELECT id, request_status
            FROM order_requests
            WHERE id = ?
            FOR UPDATE
        `, [requestId]);

        if (!rows.length) {
            await connection.rollback();
            transactionStarted = false;
            return redirectError('Request not found.');
        }

        if (rows[0].request_status !== 'pending') {
            await connection.rollback();
            transactionStarted = false;
            return redirectError('This request has already been reviewed.');
        }

        await connection.execute(`
            UPDATE order_requests
            SET request_status = ?,
                admin_note = ?,
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [decision, adminNote || null, adminId, requestId]);

        await connection.commit();
        transactionStarted = false;

        return res.redirect(
            '/admin/order-requests?message=' +
            encodeURIComponent(`Request ${decision} successfully.`)
        );

    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Request rollback error:', rollbackError);
            }
        }

        console.error('Admin review request error:', error);
        return redirectError('Unable to review this request.');
    } finally {
        if (connection) connection.release();
    }
};

function parsePromoAdminInput(body) {
    const code = String(body.code || '').trim().toUpperCase();
    const discountType = String(body.discount_type || '').trim();
    const discountValue = Number(body.discount_value);
    const minOrderAmount = body.min_order_amount === ''
        ? 0
        : Number(body.min_order_amount);
    const maxDiscount = body.max_discount === '' || body.max_discount == null
        ? null
        : Number(body.max_discount);
    const usageLimit = body.usage_limit === '' || body.usage_limit == null
        ? null
        : Number(body.usage_limit);
    const startsAt = normalizePromoDate(body.starts_at);
    const expiresAt = normalizePromoDate(body.expires_at);

    if (!/^[A-Z0-9_-]{2,50}$/.test(code)) {
        throw new Error('Code must be 2 to 50 characters using letters, numbers, hyphens, or underscores.');
    }

    if (!['percentage', 'fixed'].includes(discountType)) {
        throw new Error('Choose a valid discount type.');
    }

    if (!Number.isFinite(discountValue) || discountValue <= 0 ||
        discountValue > 99999999.99 ||
        (discountType === 'percentage' && discountValue > 100) ||
        Math.round(discountValue * 100) !== discountValue * 100) {
        throw new Error('Enter a valid discount value with up to two decimal places.');
    }

    if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0 ||
        minOrderAmount > 99999999.99 ||
        Math.round(minOrderAmount * 100) !== minOrderAmount * 100) {
        throw new Error('Enter a valid minimum order amount.');
    }

    if (maxDiscount !== null &&
        (!Number.isFinite(maxDiscount) || maxDiscount <= 0 ||
            maxDiscount > 99999999.99 ||
            Math.round(maxDiscount * 100) !== maxDiscount * 100)) {
        throw new Error('Maximum discount must be a positive amount with up to two decimal places.');
    }

    if (usageLimit !== null &&
        (!Number.isSafeInteger(usageLimit) || usageLimit <= 0 || usageLimit > 4294967295)) {
        throw new Error('Usage limit must be a positive whole number.');
    }

    if (startsAt && expiresAt && expiresAt < startsAt) {
        throw new Error('Expiry must be after the start time.');
    }

    return {
        code,
        discountType,
        discountValue,
        minOrderAmount,
        maxDiscount,
        usageLimit,
        startsAt,
        expiresAt
    };
}

function normalizePromoDate(value) {
    const raw = String(value || '').trim();

    if (!raw) return null;

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ||
        !Number.isFinite(Date.parse(raw))) {
        throw new Error('Enter valid start and expiry dates.');
    }

    return `${raw.replace('T', ' ')}:00`;
}

function promoAdminRedirect(res, key, message) {
    return res.redirect(`/admin/promos?${key}=${encodeURIComponent(message)}`);
}

exports.promos = async (req, res) => {
    try {
        const [promos] = await db.promise().execute(
            `SELECT p.*,
                    (SELECT COUNT(*)
                     FROM promo_usage_reservations r
                     WHERE r.promo_code_id = p.id
                       AND r.status = 'reserved') AS reserved_count
             FROM promo_codes p
             ORDER BY p.created_at DESC, p.id DESC`
        );

        return res.render('admin/promos', {
            admin: req.admin,
            promos,
            message: req.query.message || '',
            error: req.query.error || '',
            csrfToken: res.locals.csrfToken
        });
    } catch (error) {
        console.error('Admin promo list error:', error);
        return res.status(500).send('Unable to load promotion codes.');
    }
};

exports.createPromo = async (req, res) => {
    try {
        const promo = parsePromoAdminInput(req.body);

        await db.promise().execute(
            `INSERT INTO promo_codes
                (code, discount_type, discount_value, min_order_amount,
                 max_discount, starts_at, expires_at, usage_limit, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                promo.code,
                promo.discountType,
                promo.discountValue.toFixed(2),
                promo.minOrderAmount.toFixed(2),
                promo.maxDiscount === null ? null : promo.maxDiscount.toFixed(2),
                promo.startsAt,
                promo.expiresAt,
                promo.usageLimit
            ]
        );

        return promoAdminRedirect(res, 'message', 'Promotion created.');
    } catch (error) {
        console.error('Admin promo creation error:', error);
        const message = error.code === 'ER_DUP_ENTRY'
            ? 'A promotion with that code already exists.'
            : error.message || 'Unable to create promotion.';
        return promoAdminRedirect(res, 'error', message);
    }
};

exports.updatePromo = async (req, res) => {
    const promoId = Number(req.params.id);
    let connection;
    let transactionStarted = false;

    if (!Number.isSafeInteger(promoId) || promoId <= 0) {
        return promoAdminRedirect(res, 'error', 'Invalid promotion.');
    }

    try {
        const promo = parsePromoAdminInput(req.body);
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [currentRows] = await connection.execute(
            `SELECT id, usage_count
             FROM promo_codes
             WHERE id = ?
             FOR UPDATE`,
            [promoId]
        );

        if (!currentRows.length) {
            throw new Error('Promotion not found.');
        }

        const [reservations] = await connection.execute(
            `SELECT COUNT(*) AS reserved_count
             FROM promo_usage_reservations
             WHERE promo_code_id = ?
               AND status = 'reserved'`,
            [promoId]
        );

        if (Number(reservations[0].reserved_count) > 0) {
            throw new Error('Wait for active checkouts to finish before editing this promotion.');
        }

        if (promo.usageLimit !== null &&
            promo.usageLimit < Number(currentRows[0].usage_count)) {
            throw new Error('Usage limit cannot be lower than completed redemptions.');
        }

        await connection.execute(
            `UPDATE promo_codes
             SET code = ?, discount_type = ?, discount_value = ?,
                 min_order_amount = ?, max_discount = ?, starts_at = ?,
                 expires_at = ?, usage_limit = ?
             WHERE id = ?`,
            [
                promo.code,
                promo.discountType,
                promo.discountValue.toFixed(2),
                promo.minOrderAmount.toFixed(2),
                promo.maxDiscount === null ? null : promo.maxDiscount.toFixed(2),
                promo.startsAt,
                promo.expiresAt,
                promo.usageLimit,
                promoId
            ]
        );

        await connection.commit();
        transactionStarted = false;
        return promoAdminRedirect(res, 'message', 'Promotion updated.');
    } catch (error) {
        if (connection && transactionStarted) {
            await connection.rollback().catch(rollbackError => {
                console.error('Promo update rollback error:', rollbackError.message);
            });
        }

        console.error('Admin promo update error:', error);
        const message = error.code === 'ER_DUP_ENTRY'
            ? 'A promotion with that code already exists.'
            : error.message || 'Unable to update promotion.';
        return promoAdminRedirect(res, 'error', message);
    } finally {
        if (connection) connection.release();
    }
};

exports.togglePromo = async (req, res) => {
    const promoId = Number(req.params.id);

    if (!Number.isSafeInteger(promoId) || promoId <= 0) {
        return promoAdminRedirect(res, 'error', 'Invalid promotion.');
    }

    try {
        const [result] = await db.promise().execute(
            `UPDATE promo_codes
             SET is_active = IF(is_active = 1, 0, 1)
             WHERE id = ?`,
            [promoId]
        );

        if (!result.affectedRows) {
            return promoAdminRedirect(res, 'error', 'Promotion not found.');
        }

        return promoAdminRedirect(res, 'message', 'Promotion status updated.');
    } catch (error) {
        console.error('Admin promo status error:', error);
        return promoAdminRedirect(res, 'error', 'Unable to update promotion status.');
    }
};

