const cron = require('node-cron');
const AuditCase = require('../models/AuditCase');
const RefundRequest = require('../models/RefundRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const crypto = require('crypto');

/**
 * Execute automated compliance and fraud detection audits across the database
 */
async function runFraudDetectionChecks() {
  console.log("[Fraud Service] Initiating fraud detection audits...");
  const results = {
    refundAbusesDetected: 0,
    withdrawalAbusesDetected: 0,
    sponsorAbusesDetected: 0,
    deliveryAbusesDetected: 0,
    vendorAbusesDetected: 0
  };

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // 1. Detect Refund Abuse (>=3 requests in 24 hours)
  try {
    const refundGroups = await RefundRequest.aggregate([
      { $match: { createdAt: { $gte: oneDayAgo } } },
      { $group: { _id: "$student", count: { $sum: 1 } } },
      { $match: { count: { $gte: 3 } } }
    ]);

    for (const group of refundGroups) {
      if (!group._id) continue;
      const caseExists = await AuditCase.findOne({ user: group._id, title: 'Refund Velocity Abuse Detected' });
      if (!caseExists) {
        const caseId = `FC-RF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        await AuditCase.create({
          caseId,
          title: 'Refund Velocity Abuse Detected',
          description: `Student user requested ${group.count} refunds within a 24-hour period.`,
          detectedRules: ['Refund Abuse'],
          user: group._id,
          status: 'Open',
          riskScore: Math.min(95, 60 + group.count * 10),
          severity: group.count >= 5 ? 'CRITICAL' : 'HIGH'
        });
        results.refundAbusesDetected++;
      }
    }
  } catch (err) {
    console.error("Refund abuse detection failed:", err.message);
  }

  // 2. Detect Withdrawal Abuse (>=3 requests in 24 hours OR single request >=10,000 KES)
  try {
    const withdrawalGroups = await WithdrawalRequest.aggregate([
      { $match: { createdAt: { $gte: oneDayAgo } } },
      { $group: { _id: "$user", count: { $sum: 1 }, totalAmount: { $sum: "$amountKES" } } }
    ]);

    for (const group of withdrawalGroups) {
      if (!group._id) continue;
      
      const hasCountAbuse = group.count >= 3;
      
      // Convert Decimal128 to float safely
      let hasValueAbuse = false;
      const largeReqs = await WithdrawalRequest.find({ user: group._id, createdAt: { $gte: oneDayAgo } });
      for (const req of largeReqs) {
        if (parseFloat(req.amountKES.toString()) >= 10000) {
          hasValueAbuse = true;
          break;
        }
      }

      if (hasCountAbuse || hasValueAbuse) {
        const caseExists = await AuditCase.findOne({ user: group._id, title: 'Withdrawal Velocity Abuse Detected' });
        if (!caseExists) {
          const caseId = `FC-WD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await AuditCase.create({
            caseId,
            title: 'Withdrawal Velocity Abuse Detected',
            description: hasCountAbuse 
              ? `User requested ${group.count} manual withdrawals in 24 hours.`
              : `User requested a single high-value withdrawal >= 10,000 KES.`,
            detectedRules: ['Withdrawal Abuse'],
            user: group._id,
            status: 'Open',
            riskScore: hasValueAbuse ? 92 : 82,
            severity: 'CRITICAL'
          });
          results.withdrawalAbusesDetected++;
        }
      }
    }
  } catch (err) {
    console.error("Withdrawal abuse detection failed:", err.message);
  }

  // 3. Detect Sponsor Abuse (funding loop cycles, e.g. Sponsor -> Student -> Vendor -> Sponsor)
  try {
    const studentsWithMultipleSponsors = await Student.aggregate([
      { $match: { sponsorId: { $ne: null } } },
      { $group: { _id: "$user", sponsors: { $addToSet: "$sponsorId" } } }
    ]);

    for (const item of studentsWithMultipleSponsors) {
      if (item.sponsors.length >= 3) {
        const caseExists = await AuditCase.findOne({ user: item._id, title: 'Suspicious Sponsorship Chain' });
        if (!caseExists) {
          const caseId = `FC-SP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await AuditCase.create({
            caseId,
            title: 'Suspicious Sponsorship Chain',
            description: `Student user account is associated with ${item.sponsors.length} different sponsor accounts.`,
            detectedRules: ['Sponsor Abuse'],
            user: item._id,
            status: 'Open',
            riskScore: 90,
            severity: 'CRITICAL'
          });
          results.sponsorAbusesDetected++;
        }
      }
    }
  } catch (err) {
    console.error("Sponsor abuse detection failed:", err.message);
  }

  // 4. Detect Delivery Abuse (deliveries completed under 2 minutes after assignment/creation)
  try {
    const rapidDeliveries = await Delivery.find({
      status: 'delivered',
      deliveredAt: { $exists: true },
      createdAt: { $exists: true },
      updatedAt: { $gte: oneDayAgo }
    });

    for (const d of rapidDeliveries) {
      const start = new Date(d.createdAt).getTime();
      const end = new Date(d.deliveredAt).getTime();
      const seconds = (end - start) / 1000;

      if (seconds > 0 && seconds < 120) { // < 2 minutes
        const caseExists = await AuditCase.findOne({ transaction: d._id, title: 'Rapid Delivery Handover Detected' });
        if (!caseExists) {
          const caseId = `FC-DL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await AuditCase.create({
            caseId,
            title: 'Rapid Delivery Handover Detected',
            description: `Delivery completed in ${seconds.toFixed(0)} seconds (under 2 minutes). Driver ID: ${d.deliveryAgent || 'N/A'}.`,
            detectedRules: ['Delivery Abuse'],
            user: d.student,
            vendor: d.vendor,
            transaction: d._id,
            status: 'Open',
            riskScore: 85,
            severity: 'HIGH'
          });
          results.deliveryAbusesDetected++;
        }
      }
    }
  } catch (err) {
    console.error("Delivery abuse detection failed:", err.message);
  }

  // 5. Detect Vendor Abuse (cancellation rates >20% on >=5 total deliveries)
  try {
    const vendors = await Vendor.find({});
    for (const v of vendors) {
      const totalDeliveries = await Delivery.countDocuments({ vendor: v._id });
      if (totalDeliveries >= 5) {
        const cancelled = await Delivery.countDocuments({ vendor: v._id, status: 'cancelled' });
        const cancellationRate = cancelled / totalDeliveries;
        if (cancellationRate > 0.20) { // > 20%
          const caseExists = await AuditCase.findOne({ vendor: v._id, title: 'Abnormally High Vendor Cancellation Rate' });
          if (!caseExists) {
            const caseId = `FC-VN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
            await AuditCase.create({
              caseId,
              title: 'Abnormally High Vendor Cancellation Rate',
              description: `Vendor cancellation rate is at ${(cancellationRate * 100).toFixed(1)}% (${cancelled} cancelled out of ${totalDeliveries} orders).`,
              detectedRules: ['Vendor Abuse'],
              vendor: v._id,
              status: 'Open',
              riskScore: 72,
              severity: 'MEDIUM'
            });
            results.vendorAbusesDetected++;
          }
        }
      }
    }
  } catch (err) {
    console.error("Vendor abuse detection failed:", err.message);
  }

  console.log("[Fraud Service] Fraud detection audits complete. Results:", results);
  return results;
}

// Automatically schedule fraud checks every 6 hours
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 */6 * * *', async () => {
    try {
      await runFraudDetectionChecks();
    } catch (e) {
      console.error("Scheduled fraud check failed:", e.message);
    }
  });
}

module.exports = {
  runFraudDetectionChecks
};
