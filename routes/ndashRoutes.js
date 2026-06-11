const express = require('express');
const router = express.Router();
const {
  placeOrder,
  checkPaymentStatus,
  getStudentOrders,
  getStudentOrderDetails,
  getDriverOrders,
  getDriverOrderDetails,
  acceptOrder,
  startShopping,
  completeShopping,
  generateDriverCode,
  verifyDriverCode,
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getAdminOrders,
  getAdminStats,
  mpesaCallback
} = require('../controllers/ndashController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

// Student routes
router.post('/order', protect, role('student'), placeOrder);
router.get('/status/:checkoutRequestID', protect, role('student'), checkPaymentStatus);
router.get('/student/orders', protect, role('student'), getStudentOrders);
router.get('/student/orders/:id', protect, role('student'), getStudentOrderDetails);

// Driver routes
router.get('/driver/orders', protect, role('delivery'), getDriverOrders);
router.get('/driver/orders/:id', protect, getDriverOrderDetails); // SMS link accesses this (allows any logged in user/driver)
router.post('/driver/orders/:id/accept', protect, role('delivery'), acceptOrder);
router.post('/driver/orders/:id/start-shopping', protect, role('delivery'), startShopping);
router.post('/driver/orders/:id/complete-shopping', protect, role('delivery'), completeShopping);
router.post('/driver/orders/:id/generate-code', protect, role('delivery'), generateDriverCode);
router.post('/driver/orders/:id/verify-code', protect, role('delivery'), verifyDriverCode);

// Admin product management routes
router.get('/products', protect, getProducts); // student needs to retrieve suggested products too
router.post('/admin/products', protect, role('admin'), createProduct);
router.put('/admin/products/:id', protect, role('admin'), updateProduct);
router.delete('/admin/products/:id', protect, role('admin'), deleteProduct);

// Admin order dashboard routes
router.get('/admin/orders', protect, role('admin'), getAdminOrders);
router.get('/admin/stats', protect, role('admin'), getAdminStats);

// M-Pesa Callback Webhook
router.post('/callback', mpesaCallback);

module.exports = router;
