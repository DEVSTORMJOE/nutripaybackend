const express = require('express');
const router = express.Router();
const { getDashboard, selectMeal, optOut, getDeliverySchedule, cancelDeliveries, donateDelivery, getDonatedMeals, claimDonatedMeal, shuffleMeal, getMealChangeAlternatives, changeMeal, getMyRefundRequests, getQuickOrders } = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('student'), getDashboard);
router.get('/schedule', protect, role('student'), getDeliverySchedule);
router.post('/select-meal', protect, role('student'), selectMeal);
router.post('/opt-out', protect, role('student'), optOut);
router.post('/cancel-deliveries', protect, role('student'), cancelDeliveries);
router.post('/shuffle-meal', protect, role('student'), shuffleMeal);
router.get('/meal-change-alternatives', protect, role('student'), getMealChangeAlternatives);
router.post('/meal-change', protect, role('student'), changeMeal);
router.get('/quick-orders', protect, role('student'), getQuickOrders);



// Refund Status Route
router.get('/my-refund-requests', protect, role('student'), getMyRefundRequests);

// Donation Box routes
router.post('/donate', protect, role('student'), donateDelivery);
router.get('/donated-meals', protect, role('student'), getDonatedMeals);
router.post('/claim-meal', protect, role('student'), claimDonatedMeal);

module.exports = router;
