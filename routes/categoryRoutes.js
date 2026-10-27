
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const requireAdmin = require('../middlewares/adminMiddleware');


// GET: Retrieve visible categories for the customer storefront
router.get('/public', (req, res) => {
    const sql = `
        SELECT id, name, slug, template
        FROM categories
        WHERE is_visible = 1
        ORDER BY name ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching public categories:', err);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch categories'
            });
        }

        res.set('Cache-Control', 'no-store');

        res.json({
            success: true,
            categories: results
        });
    });
});

// GET: Retrieve all categories, including hidden categories
router.get('/', requireAdmin, (req, res) => {
    const sql = `
        SELECT id, name, slug, template, is_visible, created_at
        FROM categories
        ORDER BY name ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching categories:', err);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch categories'
            });
        }

        res.json({
            success: true,
            categories: results
        });
    });
});

// POST: Create a new category
router.post('/', requireAdmin, (req, res) => {
    let { name, template } = req.body;

    if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
            success: false,
            message: 'Category name is required'
        });
    }

    name = name.trim();
    template = template || 'standard';

    const allowedTemplates = ['standard', 'size-select'];

    if (name.length > 100) {
        return res.status(400).json({
            success: false,
            message: 'Category name must not exceed 100 characters'
        });
    }

    if (!allowedTemplates.includes(template)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid category template'
        });
    }

    const slug = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!slug) {
        return res.status(400).json({
            success: false,
            message: 'Please use a category name containing letters or numbers'
        });
    }

    const sql = `
        INSERT INTO categories (name, slug, template, is_visible)
        VALUES (?, ?, ?, TRUE)
    `;

    db.query(sql, [name, slug, template], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    success: false,
                    message: 'A category with this name or URL slug already exists'
                });
            }

            console.error('Error creating category:', err);
            return res.status(500).json({
                success: false,
                message: 'Failed to create category'
            });
        }

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            category: {
                id: result.insertId,
                name,
                slug,
                template,
                is_visible: 1
            }
        });
    });
});

// PATCH: Hide or restore a category
router.patch('/:id/visibility', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const { is_visible } = req.body;

    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: 'Invalid category ID'
        });
    }

    if (typeof is_visible !== 'boolean') {
        return res.status(400).json({
            success: false,
            message: 'is_visible must be true or false'
        });
    }

    const sql = `
        UPDATE categories
        SET is_visible = ?
        WHERE id = ?
    `;

    db.query(sql, [is_visible, id], (err, result) => {
        if (err) {
            console.error('Error updating category visibility:', err);
            return res.status(500).json({
                success: false,
                message: 'Failed to update category visibility'
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        res.json({
            success: true,
            message: is_visible
                ? 'Category made visible'
                : 'Category hidden'
        });
    });
});

module.exports = router;
