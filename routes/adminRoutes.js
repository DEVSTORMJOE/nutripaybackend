const express = require('express');
const router = express.Router();
const { getDashboard, approveMeal, getUsers, getPendingApprovals, approveVendor, getVendors, getWallets, updateWalletStatus, getTransactions, createUser, updateUser, createVendor, getMeals, updateMealApproval, getOrders, assignDriverToOrder, getDeliveryStaff, approveDelivery, getWeeklyPlans, updateWeeklyPlan, getWithdrawalRequests, handleWithdrawalRequest, assignLocationsToDriver, getRefundRequests, handleRefundApproval, getErrorLogs, resolveErrorLog } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('admin'), getDashboard);
router.get('/users', protect, role('admin'), getUsers);
router.post('/users', protect, role('admin'), createUser);
router.put('/users/:id', protect, role('admin'), updateUser);
router.get('/vendors', protect, role('admin'), getVendors);
router.post('/vendors', protect, role('admin'), createVendor);
router.get('/wallets', protect, role('admin'), getWallets);
router.post('/wallets/:id/status', protect, role('admin'), updateWalletStatus);
router.get('/transactions', protect, role('admin'), getTransactions);
router.get('/pending', protect, role('admin'), getPendingApprovals);
router.post('/approve/meal', protect, role('admin'), approveMeal);
router.post('/approve/vendor', protect, role('admin'), approveVendor);
router.get('/meals', protect, role('admin'), getMeals);
router.patch('/meals/:id/approval', protect, role('admin'), updateMealApproval);
router.get('/orders', protect, role('admin'), getOrders);
router.post('/orders/:id/assign-driver', protect, role('admin'), assignDriverToOrder);
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

// System Error Audit Logs Routing
router.get('/error-logs', protect, role('admin'), getErrorLogs);
router.post('/error-logs/:id/resolve', protect, role('admin'), resolveErrorLog);

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

router.post('/reconciliation/retry', protect, role('admin'), async (req, res) => {
  try {
    const settlementRetryService = require('../services/settlementRetryService');
    const result = await settlementRetryService.retryFailedSettlements();
    res.json({
      message: `Successfully processed retry queue. Synced: ${result.successful} transaction(s)`,
      ...result
    });
  } catch (err) {
    console.error('Manual settlement retry error:', err);
    res.status(500).json({ message: 'Retry failed: ' + err.message });
  }
});

// Stellar Security Hardening Endpoints
router.get('/stellar-security/status', protect, role('admin'), async (req, res) => {
  try {
    const stellarSecurityService = require('../services/stellarSecurityService');
    const status = await stellarSecurityService.getSecurityStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch security status: " + err.message });
  }
});

router.post('/stellar-security/configure-flags', protect, role('admin'), async (req, res) => {
  try {
    const stellarSecurityService = require('../services/stellarSecurityService');
    const result = await stellarSecurityService.configureIssuerFlags();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to configure issuer flags: " + err.message });
  }
});

router.post('/stellar-security/bootstrap', protect, role('admin'), async (req, res) => {
  try {
    const stellarSecurityService = require('../services/stellarSecurityService');
    const results = await stellarSecurityService.bootstrapPlatformTrustlines();
    res.json({ message: "Platform trustlines bootstrapped successfully", results });
  } catch (err) {
    res.status(500).json({ message: "Failed to bootstrap platform trustlines: " + err.message });
  }
});

router.post('/stellar-security/approve', protect, role('admin'), async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ message: "publicKey is required" });
  try {
    const stellarSecurityService = require('../services/stellarSecurityService');
    const txHash = await stellarSecurityService.approveTrustline(publicKey);
    res.json({ message: "Trustline approved successfully", txHash });
  } catch (err) {
    res.status(500).json({ message: "Failed to approve trustline: " + err.message });
  }
});

router.post('/stellar-security/revoke', protect, role('admin'), async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ message: "publicKey is required" });
  try {
    const stellarSecurityService = require('../services/stellarSecurityService');
    const txHash = await stellarSecurityService.revokeTrustline(publicKey);
    
    // Log permanent AuditLog for emergency revocation
    const AuditLog = require('../models/AuditLog');
    await AuditLog.create({
      action: 'manual_adjustment',
      user: req.user.id,
      details: {
        action: 'stellar_trustline_revocation',
        revokedPublicKey: publicKey,
        txHash
      }
    });

    res.json({ message: "Trustline revoked successfully", txHash });
  } catch (err) {
    res.status(500).json({ message: "Failed to revoke trustline: " + err.message });
  }
});

module.exports = router;
