const db = require('../models/database');

const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/admin/login');
    }

    const userId = req.session.user.id;

    const sql = `
        SELECT id, username, email, is_admin, is_active
        FROM signup
        WHERE id = ?
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error('Admin authentication error:', err);
            return res.status(500).send('Server error.');
        }

        if (results.length === 0) {
            req.session.destroy(() => {
                return res.redirect('/admin/login');
            });
            return;
        }

        const user = results[0];

        if (!user.is_admin || !user.is_active) {
            req.session.destroy(() => {
                return res.status(403).send(
                    'Access denied. Your administrator account is inactive or lacks administrator privileges.'
                );
            });
            return;
        }

        req.admin = user;
        next();
    });
};

module.exports = requireAdmin;