const express = require('express');
const router = express.Router();
const {
  checkout,
  createCustomOrder,
  checkCustomOrderStatus,
  refundCustomOrderController
} = require('../controllers/paymentController');
const { protect, checkActiveWallet } = require('../middleware/authMiddleware');

router.post('/checkout', protect, checkActiveWallet, checkout);
router.post('/custom-order', protect, checkActiveWallet, createCustomOrder);
router.get('/custom-order/status/:reference', checkCustomOrderStatus);
router.post('/custom-order/refund', protect, refundCustomOrderController);

module.exports = router;
