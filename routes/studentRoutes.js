const express = require('express');
const router = express.Router();
const { getDashboard, selectMeal, optOut, getDeliverySchedule, cancelDeliveries, donateDelivery, getDonatedMeals, claimDonatedMeal, shuffleMeal, getMealChangeAlternatives, changeMeal, getMyRefundRequests, getQuickOrders, requestRefund, getDonationHistory } = require('../controllers/studentController');
const { protect, checkActiveWallet } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('student'), getDashboard);
router.get('/schedule', protect, role('student'), getDeliverySchedule);
router.post('/select-meal', protect, role('student'), checkActiveWallet, selectMeal);
router.post('/opt-out', protect, role('student'), checkActiveWallet, optOut);
router.post('/cancel-deliveries', protect, role('student'), checkActiveWallet, cancelDeliveries);
router.post('/shuffle-meal', protect, role('student'), checkActiveWallet, shuffleMeal);
router.get('/meal-change-alternatives', protect, role('student'), getMealChangeAlternatives);
router.post('/meal-change', protect, role('student'), checkActiveWallet, changeMeal);
router.get('/quick-orders', protect, role('student'), getQuickOrders);
router.post('/request-refund', protect, role('student'), checkActiveWallet, requestRefund);


// Refund Status Route
router.get('/my-refund-requests', protect, role('student'), getMyRefundRequests);

// Donation Box routes
router.post('/donate', protect, role('student'), checkActiveWallet, donateDelivery);
router.get('/donated-meals', protect, role('student'), getDonatedMeals);
router.post('/claim-meal', protect, role('student'), checkActiveWallet, claimDonatedMeal);
router.get('/donation-history', protect, role('student'), getDonationHistory);

module.exports = router;
