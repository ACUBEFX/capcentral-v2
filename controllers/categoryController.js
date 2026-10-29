
const db = require('../models/database');

exports.listCategories = (req, res) => {
    const sql = `
        SELECT id, name, slug, template, is_visible, created_at
        FROM categories
        WHERE is_deleted = 0
        ORDER BY id ASC
    `;

    db.query(sql, (err, categories) => {
        if (err) {
            console.error('Error loading categories:', err);
            return res.status(500).send('Unable to load categories.');
        }

        const deletedSql = `
            SELECT id, name, slug, template, is_visible, created_at
            FROM categories
            WHERE is_deleted = 1
            ORDER BY id ASC
        `;

        db.query(deletedSql, (deletedErr, deletedCategories) => {
            if (deletedErr) {
                console.error('Error loading deleted categories:', deletedErr);
                return res.status(500).send('Unable to load deleted categories.');
            }

            res.render('admin/categories', {
                categories,
                deletedCategories,
                admin: req.admin,
                message: null,
                error: null
            });
        });
    });
};

exports.addCategory = (req, res) => {
    const name = String(req.body.name || '').trim();
    const template = req.body.template === 'size-select'
        ? 'size-select'
        : 'standard';

    if (!name) {
        return res.redirect('/admin/categories');
    }

    if (name.length > 100) {
        return res.status(400).send(
            'Category name must be 100 characters or fewer.'
        );
    }

    const slug = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!slug) {
        return res.status(400).send(
            'Please use a category name containing letters or numbers.'
        );
    }

    const sql = `
        INSERT INTO categories (name, slug, template, is_visible, is_deleted)
        VALUES (?, ?, ?, 1, 0)
    `;

    db.query(sql, [name, slug, template], (err) => {
        if (err) {
            console.error('Error adding category:', err);

            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).send(
                    'A category with that name or URL slug already exists.'
                );
            }

            return res.status(500).send('Unable to add category.');
        }

        res.redirect('/admin/categories');
    });
};

exports.toggleCategoryVisibility = (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    const sql = `
        UPDATE categories
        SET is_visible = CASE
            WHEN is_visible = 1 THEN 0
            ELSE 1
        END
        WHERE id = ? AND is_deleted = 0
    `;

    db.query(sql, [categoryId], (err, result) => {
        if (err) {
            console.error('Error updating category visibility:', err);
            return res.status(500).send(
                'Unable to update category visibility.'
            );
        }

        if (result.affectedRows === 0) {
            return res.status(404).send('Active category not found.');
        }

        res.redirect('/admin/categories');
    });
};

exports.deleteCategory = (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    const sql = `
        UPDATE categories
        SET is_deleted = 1
        WHERE id = ? AND is_deleted = 0
    `;

    db.query(sql, [categoryId], (err, result) => {
        if (err) {
            console.error('Error soft-deleting category:', err);
            return res.status(500).send('Unable to delete category.');
        }

        if (result.affectedRows === 0) {
            return res.status(404).send('Active category not found.');
        }

        res.redirect('/admin/categories');
    });
};

exports.restoreCategory = (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    const sql = `
        UPDATE categories
        SET is_deleted = 0
        WHERE id = ? AND is_deleted = 1
    `;

    db.query(sql, [categoryId], (err, result) => {
        if (err) {
            console.error('Error restoring category:', err);
            return res.status(500).send('Unable to restore category.');
        }

        if (result.affectedRows === 0) {
            return res.status(404).send('Deleted category not found.');
        }

        res.redirect('/admin/categories');
    });
};
