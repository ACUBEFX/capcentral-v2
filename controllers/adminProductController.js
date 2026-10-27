
const db = require('../models/database');

// Display all products in the admin dashboard
// Display all products in the admin dashboard
exports.listProducts = (req, res) => {
    const sql = `
        SELECT id, product_code, name, description, category, cap_type,
               price, stock_quantity, image_url, is_active
        FROM products
        ORDER BY category ASC, name ASC
    `;

    db.query(sql, (err, products) => {
        if (err) {
            console.error('Error loading admin products:', err);
            return res.status(500).send('Could not load products.');
        }

        res.render('admin/products', {
            products: products,
            admin: req.admin,
            message: null,
            error: null
        });
    });
};

// Add a new product
exports.addProduct = async (req, res) => {
    const {
        product_code,
        name,
        description,
        category,
        price,
        stock_quantity,
        image_url,
        cap_type
    } = req.body;

    const validCategories = ['Caps', 'Shoes', 'Hats', 'Thobes'];
    const validCapTypes = ['Zanna Bukar', 'Bongol', 'Atiku', 'Tinubu/Fila', 'Miyaram', 'Kindea', 'Tangaran', 'Tonak'];
    const capType = category === 'Caps' ? String(cap_type || '').trim() : null;

    const productPrice = Number(price);
    // Every cap is a unique one-off item, so a newly created cap starts at exactly one.
    const quantity = category === 'Caps'
        ? 1
        : (stock_quantity === '' || stock_quantity === undefined ? 10 : Number(stock_quantity));

    if (
        !product_code?.trim() ||
        !name?.trim() ||
        !validCategories.includes(category) ||
        (category === 'Caps' && !validCapTypes.includes(capType)) ||
        !Number.isFinite(productPrice) ||
        productPrice < 0 ||
        !Number.isInteger(quantity) ||
        quantity < 0 ||
        quantity > 4294967295
    ) {
        return res.status(400).send('Please enter valid product details.');
    }

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO products
            (product_code, name, description, category, cap_type,
             price, stock_quantity, image_url, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                product_code.trim(),
                name.trim(),
                description?.trim() || null,
                category,
                capType,
                productPrice,
                quantity,
                image_url?.trim() || null
            ]
        );

        if (quantity > 0) {
            await connection.query(
                `INSERT INTO stock_movements
                (product_code, change_quantity, previous_quantity,
                 new_quantity, reason, admin_user_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    product_code.trim(),
                    quantity,
                    0,
                    quantity,
                    'Initial stock',
                    req.admin.id
                ]
            );
        }

        await connection.query(
            `INSERT INTO admin_audit_logs
            (admin_user_id, action, entity_type, entity_id,
             details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.admin.id,
                'CREATE_PRODUCT',
                'product',
                result.insertId,
                JSON.stringify({
                    product_code: product_code.trim(),
                    name: name.trim(),
                    category,
                    cap_type: capType,
                    price: productPrice,
                    stock_quantity: quantity
                }),
                req.ip
            ]
        );

        await connection.commit();
        res.redirect('/admin/products');
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error('Error adding product:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send(
                'That product code already exists. Use a unique product code.'
            );
        }

        res.status(500).send('Could not add product.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};


// Activate or deactivate a product
exports.toggleProduct = async (req, res) => {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId < 1) {
        return res.status(400).send('Invalid product ID.');
    }

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [products] = await connection.query(
            `SELECT id, name, is_active
             FROM products
             WHERE id = ?
             FOR UPDATE`,
            [productId]
        );

        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).send('Product not found.');
        }

        const product = products[0];
        const newStatus = product.is_active ? 0 : 1;

        await connection.query(
            'UPDATE products SET is_active = ? WHERE id = ?',
            [newStatus, productId]
        );

        await connection.query(
            `INSERT INTO admin_audit_logs
            (admin_user_id, action, entity_type, entity_id,
             details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.admin.id,
                newStatus ? 'ACTIVATE_PRODUCT' : 'DEACTIVATE_PRODUCT',
                'product',
                productId,
                JSON.stringify({
                    name: product.name,
                    previous_status: product.is_active,
                    new_status: newStatus
                }),
                req.ip
            ]
        );

        await connection.commit();
        res.redirect('/admin/products');
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error('Error changing product status:', error);
        res.status(500).send('Could not update product status.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};


// Update a product's stock quantity
exports.updateStock = async (req, res) => {
    const productId = Number(req.params.id);
    const rawQuantity = req.body.stock_quantity;
    const newQuantity = Number(rawQuantity);

    if (
        !Number.isInteger(productId) ||
        productId < 1 ||
        rawQuantity === undefined ||
        rawQuantity === '' ||
        !Number.isInteger(newQuantity) ||
        newQuantity < 0 ||
        newQuantity > 4294967295
    ) {
        return res.status(400).send(
            'Please enter a valid stock quantity.'
        );
    }

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [products] = await connection.query(
            `SELECT id, product_code, name, stock_quantity
             FROM products
             WHERE id = ?
             FOR UPDATE`,
            [productId]
        );

        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).send('Product not found.');
        }

        const product = products[0];
        const previousQuantity = product.stock_quantity;
        const changeQuantity = newQuantity - previousQuantity;

        await connection.query(
            'UPDATE products SET stock_quantity = ? WHERE id = ?',
            [newQuantity, productId]
        );

        if (changeQuantity !== 0) {
            await connection.query(
                `INSERT INTO stock_movements
                (product_code, change_quantity, previous_quantity,
                 new_quantity, reason, admin_user_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    product.product_code,
                    changeQuantity,
                    previousQuantity,
                    newQuantity,
                    'Admin stock adjustment',
                    req.admin.id
                ]
            );
        }

        await connection.query(
            `INSERT INTO admin_audit_logs
            (admin_user_id, action, entity_type, entity_id,
             details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.admin.id,
                'UPDATE_STOCK',
                'product',
                product.id,
                JSON.stringify({
                    product_name: product.name,
                    previous_quantity: previousQuantity,
                    new_quantity: newQuantity
                }),
                req.ip
            ]
        );

        await connection.commit();
        res.redirect('/admin/products');
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error('Error updating stock:', error);
        res.status(500).send('Could not update stock.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};


// Edit an existing product's details and stock in one transaction.
exports.updateProduct = async (req, res) => {
    const productId = Number(req.params.id);
    const { product_code, name, description, category, cap_type, price, stock_quantity, image_url } = req.body;
    const validCategories = ['Caps', 'Shoes', 'Hats', 'Thobes'];
    const validCapTypes = ['Zanna Bukar', 'Bongol', 'Atiku', 'Tinubu/Fila', 'Miyaram', 'Kindea', 'Tangaran', 'Tonak'];
    const capType = category === 'Caps' ? String(cap_type || '').trim() : null;
    const productPrice = Number(price);
    const newQuantity = Number(stock_quantity);

    if (
        !Number.isInteger(productId) || productId < 1 ||
        !product_code?.trim() || !name?.trim() || !validCategories.includes(category) ||
        (category === 'Caps' && !validCapTypes.includes(capType)) ||
        !Number.isFinite(productPrice) || productPrice < 0 ||
        stock_quantity === undefined || stock_quantity === '' ||
        !Number.isInteger(newQuantity) || newQuantity < 0 || newQuantity > 4294967295
    ) {
        return res.status(400).send('Please enter valid product details.');
    }

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT id, product_code, name, description, category, cap_type, price,
                    stock_quantity, image_url
             FROM products WHERE id = ? FOR UPDATE`,
            [productId]
        );
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).send('Product not found.');
        }

        const old = rows[0];
        // Caps are one-of-a-kind: preserve their Available/Sold state while editing,
        // and set stock to 1 if a product is newly changed into the Caps category.
        const effectiveQuantity = category === 'Caps'
            ? (old.category === 'Caps' ? Math.min(Number(old.stock_quantity), 1) : 1)
            : newQuantity;
        const delta = effectiveQuantity - Number(old.stock_quantity);
        await connection.query(
            `UPDATE products
             SET product_code = ?, name = ?, description = ?, category = ?, cap_type = ?, price = ?,
                 stock_quantity = ?, image_url = ?
             WHERE id = ?`,
            [product_code.trim(), name.trim(), description?.trim() || null, category, capType, productPrice,
             effectiveQuantity, image_url?.trim() || null, productId]
        );

        if (delta !== 0) {
            await connection.query(
                `INSERT INTO stock_movements
                (product_code, change_quantity, previous_quantity, new_quantity,
                 reason, admin_user_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [old.product_code, delta, Number(old.stock_quantity), effectiveQuantity,
                 'Admin product edit', req.admin.id]
            );
        }

        await connection.query(
            `INSERT INTO admin_audit_logs
            (admin_user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [req.admin.id, 'EDIT_PRODUCT', 'product', productId,
             JSON.stringify({
                 previous: { product_code: old.product_code, name: old.name, category: old.category, cap_type: old.cap_type, price: old.price,
                     stock_quantity: old.stock_quantity, image_url: old.image_url },
                 updated: { product_code: product_code.trim(), name: name.trim(), category, cap_type: capType, price: productPrice,
                     stock_quantity: effectiveQuantity, image_url: image_url?.trim() || null }
             }), req.ip]
        );

        await connection.commit();
        res.redirect('/admin/products');
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error('Error editing product:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('That product code is already in use. Choose a unique code.');
        }
        res.status(500).send('Could not edit product.');
    } finally {
        if (connection) connection.release();
    }
};
