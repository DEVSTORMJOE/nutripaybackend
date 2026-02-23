const express = require('express');
const router = express.Router();
const { getAssignedDeliveries, markDelivered, getDeliveryHistory } = require('../controllers/deliveryController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware'); // Need 'delivery' role in User model too

router.get('/assigned', protect, role('delivery', 'vendor'), getAssignedDeliveries); // Vendor might check too
router.post('/complete', protect, role('delivery'), markDelivered);
router.get('/history', protect, role('delivery'), getDeliveryHistory);

module.exports = router;
