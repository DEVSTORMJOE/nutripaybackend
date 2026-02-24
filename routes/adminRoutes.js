const express = require('express');
const router = express.Router();
const { getDashboard, approveMeal, getUsers, getPendingApprovals, approveVendor, getVendors, getWallets, getTransactions } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('admin'), getDashboard);
router.get('/users', protect, role('admin'), getUsers);
router.get('/vendors', protect, role('admin'), getVendors);
router.get('/wallets', protect, role('admin'), getWallets);
router.get('/transactions', protect, role('admin'), getTransactions);
router.get('/pending', protect, role('admin'), getPendingApprovals);
router.post('/approve/meal', protect, role('admin'), approveMeal);
router.post('/approve/vendor', protect, role('admin'), approveVendor);

module.exports = router;
