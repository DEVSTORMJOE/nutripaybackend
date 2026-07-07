const express = require('express');
const router = express.Router();
const {
  checkout,
  createCustomOrder,
  checkCustomOrderStatus,
  refundCustomOrderController
} = require('../controllers/paymentController');
const { protect, checkActiveWallet } = require('../middleware/authMiddleware');
const { transactionLimiter } = require('../middleware/rateLimiters');

router.post('/checkout', protect, checkActiveWallet, transactionLimiter, checkout);
router.post('/custom-order', protect, checkActiveWallet, transactionLimiter, createCustomOrder);
router.get('/custom-order/status/:reference', transactionLimiter, checkCustomOrderStatus);
router.post('/custom-order/refund', protect, transactionLimiter, refundCustomOrderController);

module.exports = router;
