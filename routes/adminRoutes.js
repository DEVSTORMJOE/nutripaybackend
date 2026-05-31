const express = require('express');
const router = express.Router();
const { getDashboard, approveMeal, getUsers, getPendingApprovals, approveVendor, getVendors, getWallets, getTransactions, createUser, updateUser, createVendor, getMeals, updateMealApproval, getOrders, getDeliveryStaff, approveDelivery, getWeeklyPlans, updateWeeklyPlan, getWithdrawalRequests, handleWithdrawalRequest, assignLocationsToDriver, getRefundRequests, handleRefundApproval } = require('../controllers/adminController');
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
router.post('/approve/delivery', protect, role('admin'), approveDelivery);
router.get('/weekly-plans', protect, role('admin'), getWeeklyPlans);
router.post('/weekly-plans', protect, role('admin'), updateWeeklyPlan);
router.post('/delivery/assign-locations', protect, role('admin'), assignLocationsToDriver);

// Withdrawal Approval Routing
router.get('/withdrawals', protect, role('admin'), getWithdrawalRequests);
router.post('/withdrawals/:id/approve', protect, role('admin'), handleWithdrawalRequest);

// Refund Request Routing (Student Opt-Out Approvals)
router.get('/refund-requests', protect, role('admin'), getRefundRequests);
router.post('/refund-requests/:id/handle', protect, role('admin'), handleRefundApproval);

// Platform Settings & Commission Config & Shuffle Analytics Routing
const { getSettings, updateSettings, getShuffleDemandStats, updateVendorCommission } = require('../controllers/adminController');
router.get('/settings', protect, role('admin'), getSettings);
router.post('/settings', protect, role('admin'), updateSettings);
router.get('/shuffle-demand-stats', protect, role('admin'), getShuffleDemandStats);
router.post('/vendors/:id/commission', protect, role('admin'), updateVendorCommission);

// Reconciliation & Ledger Health
router.get('/reconciliation', protect, role('admin'), async (req, res) => {
  try {
    const reconciliationService = require('../services/reconciliationService');
    const report = await reconciliationService.generateReconciliationReport();
    res.json(report);
  } catch (err) {
    console.error('Reconciliation report error:', err);
    res.status(500).json({ message: 'Reconciliation failed: ' + err.message });
  }
});

module.exports = router;
