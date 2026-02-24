const express = require('express');
const router = express.Router();
const { getDashboard, selectMeal, optOut, getDeliverySchedule, cancelDeliveries } = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('student'), getDashboard);
router.get('/schedule', protect, role('student'), getDeliverySchedule);
router.post('/select-meal', protect, role('student'), selectMeal);
router.post('/opt-out', protect, role('student'), optOut);
router.post('/cancel-deliveries', protect, role('student'), cancelDeliveries);

module.exports = router;
