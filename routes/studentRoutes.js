const express = require('express');
const router = express.Router();
const { getDashboard, selectMealPlan, optOut, getDeliverySchedule } = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('student'), getDashboard);
router.get('/schedule', protect, role('student'), getDeliverySchedule);
router.post('/select-plan', protect, role('student'), selectMealPlan);
router.post('/opt-out', protect, role('student'), optOut);

module.exports = router;
