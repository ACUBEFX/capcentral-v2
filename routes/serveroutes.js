const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../models/database');








/**
 * Public API: return categories visible to customers.
 */
router.get('/api/categories', (req, res) => {
    const sql = `
        SELECT id, name, slug, template
        FROM categories
        WHERE is_visible = 1
        AND is_deleted = 0
        ORDER BY id ASC
    `;

    db.query(sql, (err, categories) => {
        if (err) {
            console.error('Error loading public categories:', err);

            return res.status(500).json({
                error: 'Could not load categories.'
            });
        }

        res.set('Cache-Control', 'no-store');
        return res.json(categories);
    });
});



router.get('/products', (req, res) => res.sendFile(path.join(__dirname, '../public', 'index1.html')));
router.get('/caps', (req, res) => res.sendFile(path.join(__dirname, '../public', 'index1.html')));
router.get('/kindea', (req, res) => res.sendFile(path.join(__dirname, '../public', 'kindea.html')));
router.get('/miyaram', (req, res) => res.sendFile(path.join(__dirname, '../public', 'miyaram.html')));
router.get('/atiku', (req, res) => res.sendFile(path.join(__dirname, '../public', 'Atiku.html')));
router.get('/bongol', (req, res) => res.sendFile(path.join(__dirname, '../public', 'bongol.html')));
// Keep the original product-card page; do not redirect to a replacement layout.
router.get('/shoes', (req, res) => res.sendFile(path.join(__dirname, '../public', 'Shoe.html')));
router.get('/tangaran', (req, res) => res.sendFile(path.join(__dirname, '../public', 'tangaran.html')));
router.get('/throbe', (req, res) => res.sendFile(path.join(__dirname, '../public', 'throbe.html')));
router.get('/tinubu', (req, res) => res.sendFile(path.join(__dirname, '../public', 'tinubu.html')));
router.get('/tonak', (req, res) => res.sendFile(path.join(__dirname, '../public', 'tonak.html')));
router.get('/trucker', (req, res) => res.sendFile(path.join(__dirname, '../public', 'trucker.html')));
router.get('/perfume', (req, res) => {res.sendFile(path.join(__dirname, '../public', 'perfume.html'));});
router.get('/shades', (req, res) => { res.sendFile(path.join(__dirname, '../public', 'shades.html'));});



/**
 * Generic page for dynamically created categories.
 * Keep this route after the existing named page routes.
 */
router.get('/category/:slug', (req, res) => {
    const slug = String(req.params.slug || '').trim();

    const sql = `
        SELECT id, name, slug, template
        FROM categories
        WHERE slug = ?
        AND is_visible = 1
        AND is_deleted = 0
        LIMIT 1
    `;

    db.query(sql, [slug], (err, rows) => {
        if (err) {
            console.error('Error loading category page:', err);
            return res.status(500).send('Unable to load category.');
        }

        if (!rows.length) {
            return res.status(404).send('Category not found.');
        }

        return res.sendFile(
            path.join(__dirname, '../public', 'category.html')
        );
    });
});





 // Public, read-only product data for existing product cards.
router.get('/api/products', (req, res) => {
    const category = req.query.category;

    if (typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({
            error: 'A valid product category is required.'
        });
    }

    const capType = req.query.capType;

    const allowedCapTypes = [
        'Zanna Bukar',
        'Bongol',
        'Atiku',
        'Tinubu/Fila',
        'Miyaram',
        'Kindea',
        'Tangaran',
        'Tonak'
    ];

    if (capType && (category.toLowerCase() !== 'caps' ||
        !allowedCapTypes.includes(capType))) {
        return res.status(400).json({
            error: 'Invalid cap type.'
        });
    }

    const sql = `
        SELECT
            p.id,
            p.product_code,
            p.name,
            p.description,
            p.category,
            p.cap_type,
            p.price,
            p.stock_quantity,
            p.image_url,
            p.is_active
        FROM products p
        INNER JOIN categories c
            ON LOWER(TRIM(p.category)) = LOWER(TRIM(c.name))
        WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(?))
          AND c.is_visible = 1
          AND p.is_active = 1
          AND (? IS NULL OR p.cap_type = ?)
        ORDER BY p.id DESC
    `;

    db.query(
        sql,
        [category, capType || null, capType || null],
        (err, products) => {
            if (err) {
                console.error('Error loading public product data:', err);
                return res.status(500).json({
                    error: 'Could not load products.'
                });
            }

            res.set('Cache-Control', 'no-store');
            res.json(products);
        }
    );
});


module.exports = router;
