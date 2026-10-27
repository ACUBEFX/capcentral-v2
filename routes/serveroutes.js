const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../models/database');
const fs = require('fs');

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



// Dynamic pages for categories created by the admin.
// Existing explicit routes above remain unchanged.
router.get('/:slug', (req, res, next) => {
    const slug = req.params.slug;

    // Do not treat API URLs as category page URLs.
    if (slug === 'api') {
        return next();
    }

    const sql = `
        SELECT name, slug, template
        FROM categories
        WHERE slug = ?
          AND is_visible = 1
        LIMIT 1
    `;

    db.query(sql, [slug], (err, rows) => {
        if (err) {
            console.error('Error loading dynamic category page:', err);
            return res.status(500).send('Could not load category page.');
        }

        if (!rows.length) {
            return next();
        }

        const category = rows[0];

        
        const templatePath = path.join(
            __dirname,
            '../public',
            'category-template.html'
        );

        fs.readFile(templatePath, 'utf8', (fileErr, html) => {
            if (fileErr) {
                console.error('Could not read category template:', fileErr);
                return res.status(500).send('Could not load category page.');
            }

            const config = {
                category: category.name,
                requiresSize: category.template === 'size-select',
                sizes: category.template === 'size-select'
                    ? ['22', '22½', '23', '23½']
                    : []
            };

            const safeConfig = JSON.stringify(config).replace(/</g, '\\u003c');

            const configScript =
                '<script>window.CAPCENTRAL_CATALOGUE = ' +
                safeConfig +
                ';</script>';

            if (!html.includes('<!-- CATEGORY_CONFIG -->')) {
                console.error('Category configuration marker is missing.');
                return res.status(500).send('Category template is not configured.');
            }

            html = html.replace('<!-- CATEGORY_CONFIG -->', configScript);

            res.set('Cache-Control', 'no-store');
            res.type('html').send(html);
        });

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
