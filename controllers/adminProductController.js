
const db = require('../models/database');

const validCapTypes = [
    'Zanna Bukar',
    'Bongol',
    'Atiku',
    'Tinubu/Fila',
    'Miyaram',
    'Kindea',
    'Tangaran',
    'Tonak'
];

// Check that the category exists in the database.
async function categoryExists(connection, category) {
    const [rows] = await connection.query(
       `SELECT id
        FROM categories
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
        AND is_deleted = 0
        LIMIT 1`,
        [category]
    );

    return rows.length > 0;
}

// Display all products and available categories in the admin dashboard.
exports.listProducts = async (req, res) => {
    try {
        const [products] = await db.promise().query(`
            SELECT id, product_code, name, description, category, cap_type,
                   price, stock_quantity, image_url, is_active
            FROM products
            ORDER BY category ASC, name ASC
        `);

        const [categories] = await db.promise().query(`
            SELECT id, name, slug, template, is_visible
            FROM categories
            WHERE is_deleted = 0
            ORDER BY name ASC
        `);

        res.render('admin/products', {
            products,
            categories,
            admin: req.admin,
            message: null,
            error: null
        });
    } catch (err) {
    console.error('Error loading admin products:', err);
    return res.status(500).send(
        'Could not load products: ' + err.message
    );
}
};

// Add a new product.
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

    const productCode = String(product_code || '').trim();
    const productName = String(name || '').trim();
    const categoryName = String(category || '').trim();
    const productPrice = Number(price);

    const capType = categoryName === 'Caps'
        ? String(cap_type || '').trim()
        : null;

    // Caps remain unique, one-off items with stock of 1.
    const quantity = categoryName === 'Caps'
        ? 1
        : (
            stock_quantity === '' || stock_quantity === undefined
                ? 10
                : Number(stock_quantity)
        );

    if (
        !productCode ||
        !productName ||
        !categoryName ||
        categoryName.length > 100 ||
        !Number.isFinite(productPrice) ||
        productPrice < 0 ||
        (categoryName === 'Caps' && !validCapTypes.includes(capType)) ||
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

        // Ensure the submitted category exists before inserting the product.
        const exists = await categoryExists(connection, categoryName);

        if (!exists) {
            await connection.rollback();
            return res.status(400).send(
                'The selected category does not exist. Please choose an existing category.'
            );
        }

        const [result] = await connection.query(
            `INSERT INTO products
                (product_code, name, description, category, cap_type,
                 price, stock_quantity, image_url, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                productCode,
                productName,
                String(description || '').trim() || null,
                categoryName,
                capType,
                productPrice,
                quantity,
                String(image_url || '').trim() || null
            ]
        );

        if (quantity > 0) {
            await connection.query(
                `INSERT INTO stock_movements
                    (product_code, change_quantity, previous_quantity,
                     new_quantity, reason, admin_user_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    productCode,
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
                    product_code: productCode,
                    name: productName,
                    category: categoryName,
                    cap_type: capType,
                    price: productPrice,
                    stock_quantity: quantity
                }),
                req.ip
            ]
        );

        await connection.commit();
        return res.redirect('/admin/products');
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

        return res.status(500).send('Could not add product.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Activate or deactivate a product.
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
        return res.redirect('/admin/products');
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error('Error changing product status:', error);
        return res.status(500).send('Could not update product status.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};


// Update a product's stock quantity.
exports.updateStock = async (req, res) => {
    const productId = Number(req.params.id);
    const rawQuantity = req.body.stock_quantity;
    const newQuantity = Number(rawQuantity);
    const reason = String(req.body.reason || '').trim();

    const allowedReasons = [
        'Stock received',
        'Damaged goods',
        'Stock correction',
        'Customer return',
        'Manual adjustment'
    ];

    if (
        !Number.isInteger(productId) ||
        productId < 1 ||
        rawQuantity === undefined ||
        rawQuantity === '' ||
        !Number.isInteger(newQuantity) ||
        newQuantity < 0 ||
        newQuantity > 4294967295
    ) {
        return res.status(400).send('Please enter a valid stock quantity.');
    }

    if (!allowedReasons.includes(reason)) {
        return res.status(400).send('Please select a valid stock adjustment reason.');
    }

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [products] = await connection.query(
            `SELECT id, product_code, name, category, stock_quantity
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
        const previousQuantity = Number(product.stock_quantity);

        // Caps are one-off products: stock can only be 0 or 1.
        if (
            String(product.category || '').trim().toLowerCase() === 'caps' &&
            newQuantity > 1
        ) {
            await connection.rollback();
            return res.status(400).send(
                'Caps are one-off products. Stock quantity cannot exceed 1.'
            );
        }

        const changeQuantity = newQuantity - previousQuantity;

        if (changeQuantity !== 0) {
            await connection.query(
                'UPDATE products SET stock_quantity = ? WHERE id = ?',
                [newQuantity, productId]
            );

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
                    reason,
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
                    new_quantity: newQuantity,
                    change_quantity: changeQuantity,
                    reason
                }),
                req.ip
            ]
        );

        await connection.commit();
        return res.redirect('/admin/products');

    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error('Error updating stock:', error);
        return res.status(500).send('Could not update stock.');

    } finally {
        if (connection) {
            connection.release();
        }
    }
};


// Display inventory movement history.
exports.inventoryHistory = async (req, res) => {
    try {
        const [movements] = await db.promise().query(
            `SELECT
                sm.id,
                sm.product_code,
                COALESCE(p.name, 'Product no longer available') AS product_name,
                sm.change_quantity,
                sm.previous_quantity,
                sm.new_quantity,
                sm.reason,
                COALESCE(s.username, 'Unknown admin') AS admin_name,
                sm.created_at
             FROM stock_movements sm
             LEFT JOIN products p
                ON p.product_code = sm.product_code
             LEFT JOIN signup s
                ON s.id = sm.admin_user_id
             ORDER BY sm.created_at DESC
             LIMIT 100`
        );

        res.render('admin/inventory-history', {
            admin: req.admin,
            movements
        });

    } catch (error) {
        console.error('Error loading inventory history:', error);
        res.status(500).send('Could not load inventory history.');
    }
};




// Edit an existing product's details and stock in one transaction.
exports.updateProduct = async (req, res) => {
    const productId = Number(req.params.id);

    const {
        product_code,
        name,
        description,
        category,
        cap_type,
        price,
        stock_quantity,
        image_url
    } = req.body;

    const productCode = String(product_code || '').trim();
    const productName = String(name || '').trim();
    const categoryName = String(category || '').trim();
    const productPrice = Number(price);
    const newQuantity = Number(stock_quantity);

    const capType = categoryName === 'Caps'
        ? String(cap_type || '').trim()
        : null;

    if (
        !Number.isInteger(productId) ||
        productId < 1 ||
        !productCode ||
        !productName ||
        !categoryName ||
        categoryName.length > 100 ||
        (categoryName === 'Caps' && !validCapTypes.includes(capType)) ||
        !Number.isFinite(productPrice) ||
        productPrice < 0 ||
        stock_quantity === undefined ||
        stock_quantity === '' ||
        !Number.isInteger(newQuantity) ||
        newQuantity < 0 ||
        newQuantity > 4294967295
    ) {
        return res.status(400).send('Please enter valid product details.');
    }

    let connection;

    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const exists = await categoryExists(connection, categoryName);

        if (!exists) {
            await connection.rollback();
            return res.status(400).send(
                'The selected category does not exist. Please choose an existing category.'
            );
        }

        const [rows] = await connection.query(
            `SELECT id, product_code, name, description, category, cap_type,
                    price, stock_quantity, image_url
             FROM products
             WHERE id = ?
             FOR UPDATE`,
            [productId]
        );

        if (!rows.length) {
            await connection.rollback();
            return res.status(404).send('Product not found.');
        }

        const old = rows[0];

        // Caps are one-of-a-kind: preserve their Available/Sold state while
        // editing, and set stock to 1 when changing another product into Caps.
        const effectiveQuantity = categoryName === 'Caps'
            ? (
                old.category === 'Caps'
                    ? Math.min(Number(old.stock_quantity), 1)
                    : 1
            )
            : newQuantity;

        const delta = effectiveQuantity - Number(old.stock_quantity);

        await connection.query(
            `UPDATE products
             SET product_code = ?, name = ?, description = ?, category = ?,
                 cap_type = ?, price = ?, stock_quantity = ?, image_url = ?
             WHERE id = ?`,
            [
                productCode,
                productName,
                String(description || '').trim() || null,
                categoryName,
                capType,
                productPrice,
                effectiveQuantity,
                String(image_url || '').trim() || null,
                productId
            ]
        );

        if (delta !== 0) {
            await connection.query(
                `INSERT INTO stock_movements
                    (product_code, change_quantity, previous_quantity,
                     new_quantity, reason, admin_user_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    old.product_code,
                    delta,
                    Number(old.stock_quantity),
                    effectiveQuantity,
                    'Admin product edit',
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
                'EDIT_PRODUCT',
                'product',
                productId,
                JSON.stringify({
                    previous: {
                        product_code: old.product_code,
                        name: old.name,
                        category: old.category,
                        cap_type: old.cap_type,
                        price: old.price,
                        stock_quantity: old.stock_quantity,
                        image_url: old.image_url
                    },
                    updated: {
                        product_code: productCode,
                        name: productName,
                        category: categoryName,
                        cap_type: capType,
                        price: productPrice,
                        stock_quantity: effectiveQuantity,
                        image_url: String(image_url || '').trim() || null
                    }
                }),
                req.ip
            ]
        );

        await connection.commit();
        return res.redirect('/admin/products');
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error('Error editing product:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send(
                'That product code is already in use. Choose a unique code.'
            );
        }

        return res.status(500).send('Could not edit product.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
