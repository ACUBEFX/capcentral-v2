
const db = require('../models/database');

function makeSlug(name) {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeSizes(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
        } catch (error) {
            // Treat ordinary text as one size per line.
        }

        return trimmed.split(/\r?\n/);
    }

    return [];
}

function validateCategory(body) {
    const name = String(body.name || '').trim();
    const template = body.template === 'size-select'
        ? 'size-select'
        : 'standard';

    if (!name || name.length > 100) {
        throw new Error('Category name must contain 1–100 characters.');
    }

    const slug = makeSlug(name);

    if (!slug) {
        throw new Error('Please use a category name containing letters or numbers.');
    }

    let sizes = normalizeSizes(body.sizes)
        .map(size => String(size).trim())
        .filter(Boolean);

    if (sizes.some(size => size.length > 50)) {
        throw new Error('Each size must be 50 characters or fewer.');
    }

    const seen = new Set();

    sizes = sizes.filter(size => {
        const key = size.toLowerCase();

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
    });

    if (sizes.length > 100) {
        throw new Error('A category cannot have more than 100 sizes.');
    }

    if (template === 'standard') {
        sizes = [];
    }

    return { name, slug, template, sizes };
}

function parseCategorySizes(categories) {
    return categories.map(category => {
        let sizes = category.sizes;

        if (typeof sizes === 'string') {
            try {
                sizes = JSON.parse(sizes);
            } catch (error) {
                sizes = [];
            }
        }

        return {
            ...category,
            sizes: Array.isArray(sizes) ? sizes : []
        };
    });
}

const categorySelect = `
    SELECT
        c.id,
        c.name,
        c.slug,
        c.template,
        c.sizes,
        c.is_visible,
        c.created_at,
        (
            SELECT COUNT(*)
            FROM products p
            WHERE LOWER(TRIM(p.category)) = LOWER(TRIM(c.name))
        ) AS product_count
    FROM categories c
    WHERE c.is_deleted = ?
    ORDER BY c.id ASC
`;

exports.listCategories = async (req, res) => {
    try {
        const [categories] = await db.promise().query(categorySelect, [0]);
        const [deletedCategories] = await db.promise().query(categorySelect, [1]);

        res.render('admin/categories', {
            categories: parseCategorySizes(categories),
            deletedCategories: parseCategorySizes(deletedCategories),
            admin: req.admin,
            message: null,
            error: null
        });
    } catch (err) {
        console.error('Error loading categories:', err);
        return res.status(500).send('Unable to load categories.');
    }
};

exports.addCategory = async (req, res) => {
    let category;

    try {
        category = validateCategory(req.body);

        if (category.template === 'size-select' && category.sizes.length === 0) {
            return res.status(400).send(
                'Please enter at least one size for a size-selection category.'
            );
        }

        await db.promise().query(`
            INSERT INTO categories
                (name, slug, template, sizes, is_visible, is_deleted)
            VALUES (?, ?, ?, ?, 1, 0)
        `, [
            category.name,
            category.slug,
            category.template,
            JSON.stringify(category.sizes)
        ]);

        return res.redirect('/admin/categories');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).send(
                'A category with that name or URL slug already exists.'
            );
        }

        if (!category) {
            return res.status(400).send(err.message);
        }

        console.error('Error adding category:', err);
        return res.status(500).send('Unable to add category.');
    }
};

exports.updateCategory = async (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    let category;

    try {
        category = validateCategory(req.body);

        if (category.template === 'size-select' && category.sizes.length === 0) {
            return res.status(400).send(
                'Please enter at least one size for a size-selection category.'
            );
        }

        const connection = await db.promise().getConnection();

        try {
            await connection.beginTransaction();

            const [rows] = await connection.query(
                `SELECT id, name FROM categories
                 WHERE id = ? AND is_deleted = 0
                 FOR UPDATE`,
                [categoryId]
            );

            if (!rows.length) {
                await connection.rollback();
                return res.status(404).send('Active category not found.');
            }

            const oldName = rows[0].name;

            await connection.query(`
                UPDATE products
                SET category = ?
                WHERE LOWER(TRIM(category)) = LOWER(TRIM(?))
            `, [category.name, oldName]);

            await connection.query(`
                UPDATE categories
                SET name = ?, slug = ?, template = ?, sizes = ?
                WHERE id = ? AND is_deleted = 0
            `, [
                category.name,
                category.slug,
                category.template,
                JSON.stringify(category.sizes),
                categoryId
            ]);

            await connection.commit();

            return res.redirect('/admin/categories');
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).send(
                'Another category already uses that name or URL slug.'
            );
        }

        if (!category) {
            return res.status(400).send(err.message);
        }

        console.error('Error updating category:', err);
        return res.status(500).send('Unable to update category.');
    }
};

exports.permanentlyDeleteCategory = async (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [categories] = await connection.query(
            'SELECT id, name FROM categories WHERE id = ? AND is_deleted = 1 FOR UPDATE',
            [categoryId]
        );

        if (!categories.length) {
            await connection.rollback();
            return res.status(404).send('Category not found.');
        }

        const [counts] = await connection.query(`
            SELECT COUNT(*) AS total
            FROM products
            WHERE LOWER(TRIM(category)) = LOWER(TRIM(?))
        `, [categories[0].name]);

        const productCount = Number(counts[0].total);

        if (productCount > 0) {
            await connection.rollback();

            return res.status(400).send(
                `This category still has ${productCount} product(s). ` +
                'Reassign those products before permanently deleting it.'
            );
        }

        await connection.query(
            'DELETE FROM categories WHERE id = ?',
            [categoryId]
        );

        await connection.commit();

        return res.redirect('/admin/categories');
    } catch (err) {
        await connection.rollback();
        console.error('Error permanently deleting category:', err);
        return res.status(500).send('Unable to permanently delete category.');
    } finally {
        connection.release();
    }
};

exports.toggleCategoryVisibility = async (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    try {
        const [result] = await db.promise().query(`
            UPDATE categories
            SET is_visible = CASE WHEN is_visible = 1 THEN 0 ELSE 1 END
            WHERE id = ? AND is_deleted = 0
        `, [categoryId]);

        if (!result.affectedRows) {
            return res.status(404).send('Active category not found.');
        }

        return res.redirect('/admin/categories');
    } catch (err) {
        console.error('Error updating category visibility:', err);
        return res.status(500).send('Unable to update category visibility.');
    }
};

exports.deleteCategory = async (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    try {
        const [result] = await db.promise().query(`
            UPDATE categories
            SET is_deleted = 1
            WHERE id = ? AND is_deleted = 0
        `, [categoryId]);

        if (!result.affectedRows) {
            return res.status(404).send('Active category not found.');
        }

        return res.redirect('/admin/categories');
    } catch (err) {
        console.error('Error soft-deleting category:', err);
        return res.status(500).send('Unable to delete category.');
    }
};

exports.restoreCategory = async (req, res) => {
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).send('Invalid category ID.');
    }

    try {
        const [result] = await db.promise().query(`
            UPDATE categories
            SET is_deleted = 0
            WHERE id = ? AND is_deleted = 1
        `, [categoryId]);

        if (!result.affectedRows) {
            return res.status(404).send('Deleted category not found.');
        }

        return res.redirect('/admin/categories');
    } catch (err) {
        console.error('Error restoring category:', err);
        return res.status(500).send('Unable to restore category.');
    }
};
