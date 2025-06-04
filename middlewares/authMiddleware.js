// middlewares/authMiddleware.js
const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');  // Redirect if user is not logged in
  }
  next();  // Proceed to the next middleware/controller
};

module.exports = { requireLogin };
