const express = require('express');
const router = express.Router();
const {
  getAuditDashboard,
  getAuditCases,
  getFraudCenterStats,
  handleCaseAction,
  getSnapshots,
  takeManualSnapshot,
  exportSnapshotsCSV,
  getAuditEvents,
  runFraudCheck,
  runFeeCheck,
  getFeeReserveLogs,
  getFeeReserveStatus
} = require('../controllers/auditController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

// Mount routes with protect and role('admin') filters
router.get('/dashboard', protect, role('admin'), getAuditDashboard);
router.get('/cases', protect, role('admin'), getAuditCases);
router.get('/fraud-stats', protect, role('admin'), getFraudCenterStats);
router.post('/cases/:id/action', protect, role('admin'), handleCaseAction);
router.get('/snapshots', protect, role('admin'), getSnapshots);
router.post('/snapshots/take', protect, role('admin'), takeManualSnapshot);
router.get('/snapshots/export', protect, role('admin'), exportSnapshotsCSV);
router.get('/events', protect, role('admin'), getAuditEvents);
router.post('/fraud-check', protect, role('admin'), runFraudCheck);
router.post('/fee-check', protect, role('admin'), runFeeCheck);
router.get('/fee-logs', protect, role('admin'), getFeeReserveLogs);
router.get('/fee-status', protect, role('admin'), getFeeReserveStatus);

module.exports = router;
