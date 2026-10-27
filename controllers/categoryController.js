
const db = require('../models/database');

exports.index = (req, res) => {
    const sql = `
        SELECT id, name, slug, template, is_visible, created_at
        FROM categories
        ORDER BY name ASC
    `;

    db.query(sql, (err, categories) => {
        if (err) {
            console.error('Error loading categories:', err);
            return res.status(500).send('Could not load categories.');
        }

        res.render('admin/categories', {
            title: 'Category Management',
            categories
        });
    });
};
