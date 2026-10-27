
const db = require('../models/database');

const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/admin/login');
    }

    const userId = req.session.user.id;

    const sql = `
        SELECT id, username, email, is_admin
        FROM signup
        WHERE id = ?
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error('Admin authentication error:', err);
            return res.status(500).send('Server error.');
        }

        if (results.length === 0 || !results[0].is_admin) {
            return res.status(403).send(
                'Access denied. Administrator privileges required.'
            );
        }

        req.admin = results[0];
        next();
    });
};

module.exports = requireAdmin;
