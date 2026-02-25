const express = require('express');
const router = express.Router();
const { getDashboard, approveMeal, getUsers, getPendingApprovals, approveVendor, getVendors, getWallets, getTransactions, createUser, updateUser, createVendor, getMeals, updateMealApproval, getOrders, getDeliveryStaff } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('admin'), getDashboard);
router.get('/users', protect, role('admin'), getUsers);
router.post('/users', protect, role('admin'), createUser);
router.put('/users/:id', protect, role('admin'), updateUser);
router.get('/vendors', protect, role('admin'), getVendors);
router.post('/vendors', protect, role('admin'), createVendor);
router.get('/wallets', protect, role('admin'), getWallets);
router.get('/transactions', protect, role('admin'), getTransactions);
router.get('/pending', protect, role('admin'), getPendingApprovals);
router.post('/approve/meal', protect, role('admin'), approveMeal);
router.post('/approve/vendor', protect, role('admin'), approveVendor);
router.get('/meals', protect, role('admin'), getMeals);
router.patch('/meals/:id/approval', protect, role('admin'), updateMealApproval);
router.get('/orders', protect, role('admin'), getOrders);
router.get('/delivery-staff', protect, role('admin'), getDeliveryStaff);

module.exports = router;
