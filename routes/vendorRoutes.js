const express = require('express');
const router = express.Router();
const { getDashboard, createMeal, getMeals, getOrders, updateOrderStatus, getDeliveryStaff, registerDeliveryStaff } = require('../controllers/vendorController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('vendor'), getDashboard);
router.post('/meals', protect, role('vendor'), createMeal);
router.get('/meals', protect, role('vendor'), getMeals); // Public? Or just vendor's? Let's make it vendor's list for management
router.get('/orders', protect, role('vendor'), getOrders);
router.put('/orders/:id', protect, role('vendor'), updateOrderStatus);
router.get('/delivery-staff', protect, role('vendor'), getDeliveryStaff);
router.post('/delivery-staff', protect, role('vendor'), registerDeliveryStaff);

const { addLocation, getLocations, deleteLocation } = require('../controllers/vendorController');
router.get('/locations', protect, role('vendor'), getLocations);
router.post('/locations', protect, role('vendor'), addLocation);
router.delete('/locations/:locId', protect, role('vendor'), deleteLocation);

module.exports = router;
