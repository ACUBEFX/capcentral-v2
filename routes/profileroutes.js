const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/profileController');

// Protect route with session check
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login'); // Redirect to login if no session
  next();  // Proceed to the next handler if user is logged in
};

router.get('/profile', requireLogin, getProfile);  // GET route for viewing profile
router.post('/profile', requireLogin, updateProfile);  // POST route for updating profile

module.exports = router;
