const express = require('express');
const router = express.Router();
const path = require('path');

//rendering the index
router.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index1.html'));
});
//rendering the kindea
router.get('/kindea', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'kindea.html'));
});
//rendering the miyaram
router.get('/miyaram', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'miyaram.html'));
});
//rendering the atiku
router.get('/atiku', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'Atiku.html'));
});
//rendering the bongol
router.get('/bongol', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'bongol.html'));
});
//rendering the shoe
router.get('/shoes', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'Shoe.html'));
});
//rendering the tangaran
router.get('/tangaran', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'tangaran.html'));
});
//rendering the throbe
router.get('/throbe', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'throbe.html'));
});
//rendering the tinubu
router.get('/tinubu', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'tinubu.html'));
});
//rendering the tonak
router.get('/tonak', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'tonak.html'));
});
//rendering the trucker
router.get('/trucker', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'trucker.html'));
});

module.exports = router;