const AuditCase = require('../models/AuditCase');
const AuditEvent = require('../models/AuditEvent');
const ReserveSnapshot = require('../models/ReserveSnapshot');
const FeeReserveLog = require('../models/FeeReserveLog');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const CustomOrder = require('../models/CustomOrder');
const RefundRequest = require('../models/RefundRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');

const reconciliationService = require('../services/reconciliationService');
const auditReserveService = require('../services/auditReserveService');
const feeReserveService = require('../services/feeReserveService');
const fraudDetectionService = require('../services/fraudDetectionService');
const { logAuditEvent } = require('../utils/auditLogger');

/**
 * GET /api/admin/audit/dashboard
 * Dashboard stats: Reserve Health, Reconciliation trends, Live counters
 */
const getAuditDashboard = async (req, res) => {
  try {
    // 1. Run live reconciliation to get live reserve health
    const reconReport = await reconciliationService.runFullReconciliation();

    // 2. Fetch live operational counters for "Today"
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todayFilter = { createdAt: { $gte: startOfToday, $lte: endOfToday } };

    // Deposits Today
    const depositTxs = await Transaction.find({
      transactionCategory: 'deposit',
      status: 'completed',
      ...todayFilter
    });
    const depositsToday = depositTxs.reduce((sum, t) => sum + parseFloat(t.amountKES ? t.amountKES.toString() : '0'), 0);

    // Quick Orders Today (Custom orders count)
    const quickOrdersToday = await CustomOrder.countDocuments(todayFilter);

    // Monthly Subscriptions Today
    const monthlySubscriptionsToday = await Subscription.countDocuments({
      status: 'active',
      ...todayFilter
    });

    // Vendor Payouts Today
    const payoutTxs = await Transaction.find({
      transactionCategory: 'payout',
      status: 'completed',
      ...todayFilter
    });
    const vendorPayoutsToday = payoutTxs.reduce((sum, t) => sum + parseFloat(t.amountKES ? t.amountKES.toString() : '0'), 0);

    // Refund Requests Today
    const refundRequestsToday = await RefundRequest.countDocuments(todayFilter);

    // Revenue Earned Today
    const revenueTxs = await Transaction.find({
      transactionCategory: 'commission',
      status: 'completed',
      ...todayFilter
    });
    const revenueEarnedToday = revenueTxs.reduce((sum, t) => sum + parseFloat(t.amountKES ? t.amountKES.toString() : '0'), 0);

    // 3. Historical snapshots (Reconciliation trends)
    const trendSnapshots = await ReserveSnapshot.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      reserveHealth: reconReport,
      reconciliationTrend: trendSnapshots,
      counters: {
        depositsToday: Number(depositsToday.toFixed(2)),
        quickOrdersToday,
        monthlySubscriptionsToday,
        vendorPayoutsToday: Number(vendorPayoutsToday.toFixed(2)),
        refundRequestsToday,
        revenueEarnedToday: Number(revenueEarnedToday.toFixed(2))
      }
    });

  } catch (error) {
    console.error("Audit dashboard error:", error);
    res.status(500).json({ message: "Failed to load audit dashboard: " + error.message });
  }
};

/**
 * GET /api/admin/audit/cases
 * Get all fraud cases
 */
const getAuditCases = async (req, res) => {
  try {
    const cases = await AuditCase.find()
      .populate('user', 'name email role phone isApproved')
      .populate('vendor', 'businessName approvedStatus user')
      .populate('transaction')
      .sort({ createdAt: -1 });
    res.json(cases);
  } catch (error) {
    res.status(500).json({ message: "Failed to load cases: " + error.message });
  }
};

/**
 * POST /api/admin/audit/cases/:id/action
 * Process case actions: Freeze User, Freeze Vendor, Notes, Isolate/Release funds, Status change
 */
const handleCaseAction = async (req, res) => {
  const { id } = req.params;
  const { action, note, source, amountKES } = req.body;
  const actor = req.user.email;

  try {
    const auditCase = await AuditCase.findById(id).populate('user');
    if (!auditCase) {
      return res.status(404).json({ message: "Audit case not found" });
    }

    if (action === 'add_note') {
      if (!note) return res.status(400).json({ message: "Note content is required" });
      auditCase.notes.push({ actor, note });
      auditCase.auditTrail.push({ action: 'note_added', details: { note }, timestamp: new Date() });
      await auditCase.save();
      return res.json({ message: "Note added successfully", auditCase });
    }

    if (action === 'status_change') {
      const { status } = req.body;
      if (!['Open', 'Investigating', 'Resolved', 'Escalated', 'Ignored'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      auditCase.status = status;
      auditCase.auditTrail.push({ action: 'status_updated', details: { status }, timestamp: new Date() });
      await auditCase.save();
      await logAuditEvent(req.user.id, 'Fraud Actions', 'AuditCase', [id], { action: 'status_change', newStatus: status }, req);
      return res.json({ message: `Case status changed to ${status}`, auditCase });
    }

    if (action === 'assign_investigator') {
      const { investigator } = req.body;
      auditCase.assignedInvestigator = investigator || req.user.email;
      auditCase.auditTrail.push({ action: 'investigator_assigned', details: { investigator: auditCase.assignedInvestigator }, timestamp: new Date() });
      await auditCase.save();
      return res.json({ message: `Investigator assigned to ${auditCase.assignedInvestigator}`, auditCase });
    }

    if (action === 'freeze_user') {
      if (!auditCase.user) return res.status(400).json({ message: "No user linked to this case" });
      const targetUser = await User.findById(auditCase.user._id);
      if (targetUser) {
        targetUser.isApproved = false;
        await targetUser.save();
      }
      const targetWallet = await Wallet.findOne({ user: auditCase.user._id });
      if (targetWallet) {
        targetWallet.status = 'frozen';
        await targetWallet.save();
      }
      auditCase.auditTrail.push({ action: 'user_frozen', details: { userId: auditCase.user._id }, timestamp: new Date() });
      await auditCase.save();
      await logAuditEvent(req.user.id, 'User Suspension', 'User', [auditCase.user._id], { action: 'freeze' }, req);
      return res.json({ message: "User access and wallet successfully frozen.", auditCase });
    }

    if (action === 'unfreeze_user') {
      if (!auditCase.user) return res.status(400).json({ message: "No user linked to this case" });
      const targetUser = await User.findById(auditCase.user._id);
      if (targetUser) {
        targetUser.isApproved = true;
        await targetUser.save();
      }
      const targetWallet = await Wallet.findOne({ user: auditCase.user._id });
      if (targetWallet) {
        targetWallet.status = 'active';
        await targetWallet.save();
      }
      auditCase.auditTrail.push({ action: 'user_unfrozen', details: { userId: auditCase.user._id }, timestamp: new Date() });
      await auditCase.save();
      await logAuditEvent(req.user.id, 'User Suspension', 'User', [auditCase.user._id], { action: 'unfreeze' }, req);
      return res.json({ message: "User access and wallet successfully restored.", auditCase });
    }

    if (action === 'freeze_vendor') {
      if (!auditCase.vendor) return res.status(400).json({ message: "No vendor linked to this case" });
      const vendorRecord = await Vendor.findById(auditCase.vendor);
      if (vendorRecord) {
        vendorRecord.approvedStatus = 'rejected';
        await vendorRecord.save();

        const targetUser = await User.findById(vendorRecord.user);
        if (targetUser) {
          targetUser.isApproved = false;
          await targetUser.save();
        }
        const targetWallet = await Wallet.findOne({ user: vendorRecord.user });
        if (targetWallet) {
          targetWallet.status = 'frozen';
          await targetWallet.save();
        }
      }
      auditCase.auditTrail.push({ action: 'vendor_frozen', details: { vendorId: auditCase.vendor }, timestamp: new Date() });
      await auditCase.save();
      await logAuditEvent(req.user.id, 'Vendor Suspension', 'Vendor', [auditCase.vendor], { action: 'freeze' }, req);
      return res.json({ message: "Vendor business profile, login access, and settlement wallet frozen.", auditCase });
    }

    if (action === 'unfreeze_vendor') {
      if (!auditCase.vendor) return res.status(400).json({ message: "No vendor linked to this case" });
      const vendorRecord = await Vendor.findById(auditCase.vendor);
      if (vendorRecord) {
        vendorRecord.approvedStatus = 'approved';
        await vendorRecord.save();

        const targetUser = await User.findById(vendorRecord.user);
        if (targetUser) {
          targetUser.isApproved = true;
          await targetUser.save();
        }
        const targetWallet = await Wallet.findOne({ user: vendorRecord.user });
        if (targetWallet) {
          targetWallet.status = 'active';
          await targetWallet.save();
        }
      }
      auditCase.auditTrail.push({ action: 'vendor_unfrozen', details: { vendorId: auditCase.vendor }, timestamp: new Date() });
      await auditCase.save();
      await logAuditEvent(req.user.id, 'Vendor Suspension', 'Vendor', [auditCase.vendor], { action: 'unfreeze' }, req);
      return res.json({ message: "Vendor business profile, login access, and settlement wallet restored.", auditCase });
    }

    if (action === 'isolate_funds') {
      if (!source || !amountKES) return res.status(400).json({ message: "Source and amount KES are required" });
      const txHash = await auditReserveService.isolateFunds(source, amountKES, id, req.user.id, req);
      return res.json({ message: `Successfully isolated ${amountKES} NT from ${source} on-chain. Hash: ${txHash}`, auditCase });
    }

    if (action === 'release_funds') {
      const txHash = await auditReserveService.releaseFunds(id, req.user.id, req);
      return res.json({ message: `Successfully released isolated reserves on-chain. Hash: ${txHash}`, auditCase });
    }

    return res.status(400).json({ message: "Invalid action type specified" });

  } catch (error) {
    console.error("Case action failed:", error);
    res.status(500).json({ message: "Case action failed: " + error.message });
  }
};

/**
 * GET /api/admin/audit/snapshots
 * Get list of reserve snapshots
 */
const getSnapshots = async (req, res) => {
  try {
    const snapshots = await ReserveSnapshot.find().sort({ createdAt: -1 });
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch snapshots: " + error.message });
  }
};

/**
 * POST /api/admin/audit/snapshots/take
 * Capture reserve snapshot manually
 */
const takeManualSnapshot = async (req, res) => {
  try {
    const reserveSnapshotService = require('../services/reserveSnapshotService');
    const snapshot = await reserveSnapshotService.takeReserveSnapshot();
    res.json({ message: "Snapshot successfully captured and reconciled.", snapshot });
  } catch (error) {
    res.status(500).json({ message: "Snapshot capture failed: " + error.message });
  }
};

/**
 * GET /api/admin/audit/snapshots/export
 * Export Reserve Snapshots as CSV
 */
const exportSnapshotsCSV = async (req, res) => {
  try {
    const snapshots = await ReserveSnapshot.find().sort({ createdAt: -1 });
    let csv = "Date,Status,Treasury (DB),Treasury (Stellar),Escrow (DB),Escrow (Stellar),Vendor (DB),Vendor (Stellar),Revenue (DB),Revenue (Stellar),Audit Reserve (Stellar),Fee Reserve (Stellar)\n";
    
    for (const s of snapshots) {
      const date = new Date(s.createdAt).toISOString();
      csv += `${date},${s.status},${s.mongodbAvailableKES},${s.treasuryNT},${s.mongodbLockedKES},${s.escrowNT},${s.mongodbVendorSettlementKES},${s.vendorSettlementNT},${s.mongodbRevenueKES},${s.revenueNT},${s.auditReserveNT || 0},${s.feeReserveXLM || 0}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=reserve_snapshots_audit.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: "Failed to export snapshots CSV: " + error.message });
  }
};

/**
 * GET /api/admin/audit/events
 * Get immutable administrative logs
 */
const getAuditEvents = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const events = await AuditEvent.find().sort({ timestamp: -1 }).limit(100).lean();
    
    // Resolve actor User IDs to human-readable names and emails
    const userIds = events.map(e => e.actor).filter(id => mongoose.Types.ObjectId.isValid(id));
    const User = require('../models/User');
    const users = await User.find({ _id: { $in: userIds } }, 'name email');
    const userMap = users.reduce((map, u) => {
      map[u._id.toString()] = `${u.name} (${u.email})`;
      return map;
    }, {});

    const enrichedEvents = events.map(e => ({
      ...e,
      actorName: userMap[e.actor] || e.actor
    }));

    res.json(enrichedEvents);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch audit events: " + error.message });
  }
};

/**
 * POST /api/admin/audit/fraud-check
 * Trigger manual execution of fraud audits
 */
const runFraudCheck = async (req, res) => {
  try {
    const report = await fraudDetectionService.runFraudDetectionChecks();
    res.json({ message: "Fraud detection checks successfully run.", report });
  } catch (error) {
    res.status(500).json({ message: "Failed to run fraud checks: " + error.message });
  }
};

/**
 * POST /api/admin/audit/fee-check
 * Trigger manual execution of fee reserves audits
 */
const runFeeCheck = async (req, res) => {
  try {
    const report = await feeReserveService.monitorFeeReserve('MANUAL_ADMIN');
    res.json({ message: "Fee Reserve monitor checks successfully run.", report });
  } catch (error) {
    res.status(500).json({ message: "Failed to run fee checks: " + error.message });
  }
};

/**
 * GET /api/admin/audit/fee-logs
 * Retrieves history of Fee Reserve operational wallet refills
 */
const getFeeReserveLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.status) {
      query.status = req.query.status;
    }
    if (req.query.walletName) {
      query.destinationWalletName = req.query.walletName;
    }

    const logs = await FeeReserveLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const total = await FeeReserveLog.countDocuments(query);

    res.json({
      logs,
      page,
      pages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    console.error("Failed to fetch fee reserve logs:", error);
    res.status(500).json({ message: "Failed to fetch fee reserve logs: " + error.message });
  }
};

/**
 * GET /api/admin/audit/fee-status
 * Retrieves live on-chain XLM balances and health metrics for all operational wallets
 */
const getFeeReserveStatus = async (req, res) => {
  try {
    const walletStatuses = await feeReserveService.getOperationalWalletBalances();
    res.json({
      success: true,
      wallets: walletStatuses,
      feeReserveMinXLM: parseFloat(process.env.FEE_RESERVE_MIN_XLM || '20'),
      operationalMinXLM: parseFloat(process.env.OPERATIONAL_MIN_XLM || '5'),
      operationalTargetXLM: parseFloat(process.env.OPERATIONAL_TARGET_XLM || '15'),
      cronSchedule: process.env.FEE_RESERVE_CRON_SCHEDULE || '0 * * * *'
    });
  } catch (error) {
    console.error("Failed to fetch operational wallet fee status:", error);
    res.status(500).json({ message: "Failed to fetch fee status: " + error.message });
  }
};

/**
 * GET /api/admin/audit/fraud-stats
 * Aggregates SOC Fraud Center statistics, anomaly breakdown, and high-risk signals
 */
const getFraudCenterStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Anomaly Counts by Time Window
    const dailyAnomalies = await AuditCase.countDocuments({ createdAt: { $gte: startOfToday } });
    const weeklyAnomalies = await AuditCase.countDocuments({ createdAt: { $gte: startOfWeek } });
    const monthlyAnomalies = await AuditCase.countDocuments({ createdAt: { $gte: startOfMonth } });

    // Status Counts
    const openCases = await AuditCase.countDocuments({ status: 'Open' });
    const investigatingCases = await AuditCase.countDocuments({ status: 'Investigating' });
    const resolvedCases = await AuditCase.countDocuments({ status: 'Resolved' });
    const ignoredCases = await AuditCase.countDocuments({ status: 'Ignored' });
    const escalatedCases = await AuditCase.countDocuments({ status: 'Escalated' });

    // Total Isolated Assets KES
    const isolatedAgg = await AuditCase.aggregate([
      { $match: { isolatedAmountKES: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$isolatedAmountKES" } } }
    ]);
    const totalIsolatedAssetsKES = isolatedAgg[0]?.total || 0;

    // Severity Breakdown
    const criticalCount = await AuditCase.countDocuments({ severity: 'CRITICAL', status: { $ne: 'Resolved' } });
    const highCount = await AuditCase.countDocuments({ severity: 'HIGH', status: { $ne: 'Resolved' } });
    const mediumCount = await AuditCase.countDocuments({ severity: 'MEDIUM', status: { $ne: 'Resolved' } });
    const lowCount = await AuditCase.countDocuments({ severity: 'LOW', status: { $ne: 'Resolved' } });

    // Rule Category Distribution
    const ruleDistribution = await AuditCase.aggregate([
      { $unwind: "$detectedRules" },
      { $group: { _id: "$detectedRules", count: { $sum: 1 } } }
    ]);

    // Top Suspicious Users
    const suspiciousUsersAgg = await AuditCase.aggregate([
      { $match: { user: { $ne: null } } },
      { $group: { _id: "$user", caseCount: { $sum: 1 }, maxRiskScore: { $max: "$riskScore" } } },
      { $sort: { maxRiskScore: -1, caseCount: -1 } },
      { $limit: 5 }
    ]);
    await User.populate(suspiciousUsersAgg, { path: '_id', select: 'name email role isApproved' });

    // Top Suspicious Vendors
    const suspiciousVendorsAgg = await AuditCase.aggregate([
      { $match: { vendor: { $ne: null } } },
      { $group: { _id: "$vendor", caseCount: { $sum: 1 }, maxRiskScore: { $max: "$riskScore" } } },
      { $sort: { maxRiskScore: -1, caseCount: -1 } },
      { $limit: 5 }
    ]);
    await Vendor.populate(suspiciousVendorsAgg, { path: '_id', select: 'businessName approvedStatus' });

    // Top Suspicious Wallets
    const suspiciousWallets = await Wallet.find({ status: { $in: ['frozen', 'suspended'] } })
      .limit(5)
      .populate('user', 'name email role')
      .lean();

    // High-Risk Signals & Largest Transactions
    const largestTxs = await Transaction.find({ status: 'completed' })
      .sort({ amountKES: -1 })
      .limit(5)
      .populate('fromUser', 'name email')
      .populate('toUser', 'name email')
      .lean();

    const repeatedRefunds = await RefundRequest.aggregate([
      { $group: { _id: "$student", count: { $sum: 1 }, totalAmount: { $sum: "$amountKES" } } },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);
    await User.populate(repeatedRefunds, { path: '_id', select: 'name email' });

    const repeatedWithdrawals = await WithdrawalRequest.aggregate([
      { $group: { _id: "$user", count: { $sum: 1 } } },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);
    await User.populate(repeatedWithdrawals, { path: '_id', select: 'name email' });

    res.json({
      counters: {
        dailyAnomalies,
        weeklyAnomalies,
        monthlyAnomalies,
        openCases,
        investigatingCases,
        resolvedCases,
        ignoredCases,
        escalatedCases,
        totalIsolatedAssetsKES,
        criticalCount,
        highCount,
        mediumCount,
        lowCount
      },
      ruleDistribution,
      suspiciousUsers: suspiciousUsersAgg.map(u => ({ user: u._id, caseCount: u.caseCount, riskScore: u.maxRiskScore || 85 })),
      suspiciousVendors: suspiciousVendorsAgg.map(v => ({ vendor: v._id, caseCount: v.caseCount, riskScore: v.maxRiskScore || 75 })),
      suspiciousWallets,
      largestTxs,
      repeatedRefunds,
      repeatedWithdrawals
    });
  } catch (error) {
    console.error("Fraud center stats error:", error);
    res.status(500).json({ message: "Failed to load fraud center stats: " + error.message });
  }
};

module.exports = {
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
};
