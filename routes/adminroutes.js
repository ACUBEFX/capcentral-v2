const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const requireAdmin = require('../middlewares/adminMiddleware');
const adminProductController = require('../controllers/adminProductController');
const categoryController = require('../controllers/categoryController');

// Admin login page and submission
router.get('/admin/login', adminController.renderLogin);
router.post('/admin/login', adminController.login);

// Admin dashboard and product management
router.get('/admin', requireAdmin, adminController.dashboard);
router.get('/admin/orders', requireAdmin, adminController.orders);
router.get('/admin/payments', requireAdmin, adminController.payments);
router.get('/admin/services', requireAdmin, adminController.services);
router.get('/admin/customers', requireAdmin, adminController.customers);
router.get('/admin/customers/:id', requireAdmin, adminController.customerDetails);
router.get('/admin/customers/:id/edit', requireAdmin, adminController.editCustomerForm);
router.post('/admin/customers/:id/edit', requireAdmin, adminController.updateCustomer);
router.post('/admin/customers/:id/active', requireAdmin, adminController.toggleCustomerActive);
router.post('/admin/customers/:id/delete', requireAdmin, adminController.deleteCustomer);
router.get('/admin/deliveries', requireAdmin, adminController.deliveries);
router.post('/admin/deliveries/:id/status', requireAdmin, adminController.updateDeliveryStatus);
router.post('/admin/deliveries/:id/details', requireAdmin, adminController.updateDeliveryDetails);
router.post('/admin/orders/:id/status', requireAdmin, adminController.updateOrderStatus);
router.post('/admin/services/:id/status', requireAdmin, adminController.updateServiceStatus);
router.get('/admin/revenue', requireAdmin, adminController.revenue);
router.get('/admin/products', requireAdmin, adminProductController.listProducts);
router.post('/admin/products', requireAdmin, adminProductController.addProduct);
router.post('/admin/products/:id/edit', requireAdmin, adminProductController.updateProduct);
router.post('/admin/products/:id/toggle', requireAdmin, adminProductController.toggleProduct);
router.post('/admin/products/:id/stock', requireAdmin, adminProductController.updateStock);
router.get('/admin/categories', requireAdmin, categoryController.index);

module.exports = router;
