const express = require('express');
const router = express.Router();
const {
  checkout,
  createCustomOrder,
  checkCustomOrderStatus,
  refundCustomOrderController
} = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

router.post('/checkout', protect, checkout);
router.post('/custom-order', createCustomOrder);
router.get('/custom-order/status/:reference', checkCustomOrderStatus);
router.post('/custom-order/refund', protect, refundCustomOrderController);

module.exports = router;
