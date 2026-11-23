
// middlewares/authMiddleware.js

const requireLogin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    next();
};

const requireAdmin = (req, res, next) => {
    const user = req.session?.user;

    if (!user) {
        return res.redirect('/admin/login');
    }

    if (
        user.is_admin !== 1 &&
        user.is_admin !== true &&
        user.isAdmin !== true &&
        user.role !== 'admin'
    ) {
        return res.status(403).send('Access denied. Admin privileges required.');
    }

    next();
};

module.exports = {
    requireLogin,
    requireAdmin
};
