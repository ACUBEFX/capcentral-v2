const express = require('express');
const router = express.Router();


const { csrfSync } = require('csrf-sync');

const {
    generateToken,
    csrfSynchronisedProtection
} = csrfSync({
    getTokenFromRequest: (req) => {
        if (req.is('application/x-www-form-urlencoded') ||
            req.is('multipart/form-data')) {
            return req.body?._csrf;
        }

        return req.headers['x-csrf-token'];
    }
});

const adminController = require('../controllers/adminController');
const requireAdmin = require('../middlewares/adminMiddleware');
const adminProductController = require('../controllers/adminProductController');
const categoryController = require('../controllers/categoryController');


// Admin login page and submission
router.get('/admin/login', adminController.renderLogin);
router.post('/admin/login', adminController.login);
// Protect all subsequent admin routes against CSRF attacks.
router.use('/admin', csrfSynchronisedProtection);
// Generate a CSRF token for admin pages and make it available to EJS views.
router.use('/admin', (req, res, next) => {
    res.locals.csrfToken = generateToken(req);
    next();
});

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
router.get('/admin/categories', requireAdmin, categoryController.listCategories);
router.get('/admin/promos', requireAdmin, adminController.promos);
router.post('/admin/promos', requireAdmin, adminController.createPromo);
router.post('/admin/promos/:id/edit', requireAdmin, adminController.updatePromo);
router.post('/admin/promos/:id/toggle', requireAdmin, adminController.togglePromo);
router.post('/admin/categories', requireAdmin, categoryController.addCategory);
router.post('/admin/categories/:id/toggle', requireAdmin, categoryController.toggleCategoryVisibility);
router.post('/admin/categories/:id/delete', requireAdmin, categoryController.deleteCategory);
router.post('/admin/categories/:id/restore', requireAdmin, categoryController.restoreCategory);
router.get('/admin/products', requireAdmin, adminProductController.listProducts);
router.get('/admin/inventory-history', requireAdmin, adminProductController.inventoryHistory);
router.post('/admin/products', requireAdmin, adminProductController.addProduct);
router.post('/admin/products/:id/edit', requireAdmin, adminProductController.updateProduct);
router.post('/admin/products/:id/toggle', requireAdmin, adminProductController.toggleProduct);
router.post('/admin/products/:id/stock', requireAdmin, adminProductController.updateStock);
router.get('/admin/order-requests', requireAdmin, adminController.orderRequests);
router.post('/admin/order-requests/:id/review', requireAdmin, adminController.reviewOrderRequest);


module.exports = router;
