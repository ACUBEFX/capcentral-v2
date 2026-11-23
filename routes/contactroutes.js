const express = require('express');
const router = express.Router();
const { handleContactForm } = require('../controllers/contactController');

router.post('/contact', (req, res) => {
  handleContactForm(req, res, () => {
    res.redirect('back');
  });
});

module.exports = router;

