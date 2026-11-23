
const db = require('../models/database');

// =====================================================
// GET CUSTOMER PROFILE, ORDER HISTORY AND REQUESTS
// =====================================================
exports.getProfile = async (req, res) => {
    try {
        const userId = Number(req.session?.user?.id);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.redirect('/login');
        }

        const [users] = await db.promise().execute(
            `SELECT id, username, email, phone_number, address
             FROM signup
             WHERE id = ?
             LIMIT 1`,
            [userId]
        );

        if (!users.length) {
            return res.redirect('/login');
        }

        const user = users[0];

        const [orders] = await db.promise().execute(
            `SELECT
                id,
                user_id,
                order_reference,
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
                created_at,
                updated_at
             FROM orders
             WHERE user_id = ? OR customer_email = ?
             ORDER BY created_at DESC`,
            [userId, user.email]
        );

        if (orders.length > 0) {
            const orderIds = orders.map(order => order.id);
            const placeholders = orderIds.map(() => '?').join(',');

            const [items] = await db.promise().execute(
                `SELECT order_id, product_name, product_size,
                        quantity, unit_price, total_price
                 FROM order_items
                 WHERE order_id IN (${placeholders})
                 ORDER BY id ASC`,
                orderIds
            );

            orders.forEach(order => {
                order.items = items.filter(
                    item => Number(item.order_id) === Number(order.id)
                );
            });
        }

        orders.forEach(order => {
            order.items = order.items || [];
        });

        const [requests] = await db.promise().execute(
            `SELECT
                r.id,
                r.order_id,
                r.request_type,
                r.reason,
                r.request_status,
                r.admin_note,
                r.created_at,
                o.order_reference
             FROM order_requests r
             INNER JOIN orders o ON o.id = r.order_id
             WHERE r.user_id = ?
             ORDER BY r.created_at DESC`,
            [userId]
        );

        return res.render('profile', {
            user,
            orders,
            requests
        });

    } catch (error) {
        console.error('Profile loading error:', error);
        return res.status(500).send('Unable to load your profile.');
    }
};


// =====================================================
// UPDATE CUSTOMER PROFILE
// =====================================================
exports.updateProfile = async (req, res) => {
    try {
        const userId = Number(req.session?.user?.id);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.redirect('/login');
        }

        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const phone = String(req.body.phone || '').trim();
        const address = String(req.body.address || '').trim();

        if (!username || username.length > 255) {
            return res.status(400).send('Enter a valid username.');
        }

        if (
            !email ||
            email.length > 255 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return res.status(400).send('Enter a valid email address.');
        }

        if (phone.length > 20) {
            return res.status(400).send('Phone number is too long.');
        }

        if (address.length > 65535) {
            return res.status(400).send('Address is too long.');
        }

        const [existingUsers] = await db.promise().execute(
            `SELECT id FROM signup
             WHERE email = ? AND id <> ?
             LIMIT 1`,
            [email, userId]
        );

        if (existingUsers.length) {
            return res.status(409).send('That email address is already in use.');
        }

        await db.promise().execute(
            `UPDATE signup
             SET username = ?, email = ?, phone_number = ?, address = ?
             WHERE id = ?`,
            [username, email, phone || null, address || null, userId]
        );

        req.session.user = {
            ...req.session.user,
            id: userId,
            username,
            email,
            phone_number: phone,
            address
        };

        req.session.save(error => {
            if (error) {
                console.error('Profile session update error:', error);
                return res.status(500).send(
                    'Profile saved, but session refresh failed.'
                );
            }

            return res.redirect('/my-deliveries');
        });

    } catch (error) {
        console.error('Profile update error:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send(
                'That email address is already in use.'
            );
        }

        return res.status(500).send('Unable to update your profile.');
    }
};


// =====================================================
// CUSTOMER CANCELLATION AND REFUND REQUEST
// =====================================================
exports.submitOrderRequest = async (req, res) => {
    let connection;

    try {
        const userId = Number(req.session?.user?.id);
        const orderId = Number(req.body.order_id);
        const requestType = String(req.body.request_type || '').trim();
        const reason = String(req.body.reason || '').trim();

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.redirect('/login');
        }

        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
            return res.status(400).send('Invalid order.');
        }

        if (!['cancellation', 'refund'].includes(requestType)) {
            return res.status(400).send('Invalid request type.');
        }

        if (!reason || reason.length > 2000) {
            return res.status(400).send(
                'Please provide a reason of no more than 2,000 characters.'
            );
        }

        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, order_status
             FROM orders
             WHERE id = ? AND user_id = ?
             FOR UPDATE`,
            [orderId, userId]
        );

        if (!orders.length) {
            await connection.rollback();
            return res.status(404).send('Order not found.');
        }

        const order = orders[0];
        const status = String(order.order_status).toLowerCase();

        if (['cancelled', 'refunded'].includes(status)) {
            await connection.rollback();
            return res.status(400).send(
                'This order can no longer receive a request.'
            );
        }

        if (requestType === 'refund') {
            const [payments] = await connection.execute(
                `SELECT id
                 FROM payments
                 WHERE order_id = ?
                   AND payment_status = 'success'
                 LIMIT 1`,
                [orderId]
            );

            if (!payments.length) {
                await connection.rollback();
                return res.status(400).send(
                    'A refund request requires a successful payment.'
                );
            }
        }

        const [existing] = await connection.execute(
            `SELECT id
             FROM order_requests
             WHERE order_id = ?
               AND user_id = ?
               AND request_type = ?
               AND request_status = 'pending'
             LIMIT 1`,
            [orderId, userId, requestType]
        );

        if (existing.length) {
            await connection.rollback();
            return res.status(409).send(
                'You already have a pending request of this type for this order.'
            );
        }

        await connection.execute(
            `INSERT INTO order_requests
                (order_id, user_id, request_type, reason)
             VALUES (?, ?, ?, ?)`,
            [orderId, userId, requestType, reason]
        );

        await connection.commit();

        return res.redirect('/my-deliveries');

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error('Order request error:', error);
        return res.status(500).send(
            'Unable to submit your request. Please try again.'
        );

    } finally {
        if (connection) {
            connection.release();
        }
    }
};
