const express = require('express');
const router = express.Router();
const { getDashboard, createMealPlan, getMealPlans, getOrders, updateOrderStatus } = require('../controllers/vendorController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('vendor'), getDashboard);
router.post('/mealplans', protect, role('vendor'), createMealPlan);
router.get('/mealplans', protect, role('vendor'), getMealPlans); // Public? Or just vendor's? Let's make it vendor's list for management
router.get('/orders', protect, role('vendor'), getOrders);
router.put('/orders/:id', protect, role('vendor'), updateOrderStatus);

module.exports = router;
