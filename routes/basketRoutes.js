// routes/basketRoutes.js
const express = require('express');
const router = express.Router();
const basketController = require('../controllers/basketController');

router.post('/checkout', basketController.checkout);
router.post('/pay', basketController.pay);

module.exports = router;