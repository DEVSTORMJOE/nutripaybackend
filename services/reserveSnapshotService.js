const ReserveSnapshot = require('../models/ReserveSnapshot');
const reconciliationService = require('./reconciliationService');
const cron = require('node-cron');

/**
 * Executes a full Proof-of-Reserve audit and persists the results 
 * into a ReserveSnapshot document for institutional audit evidence and compliance.
 */
async function takeReserveSnapshot() {
  console.log("[Audit Server] Triggering daily Reserve Snapshot...");
  
  try {
    // 1. Run the reconciliation auditor to retrieve active balances
    const audit = await reconciliationService.runFullReconciliation();
    
    const db = audit.db;
    const stellar = audit.stellar;

    // 2. Compute precise discrepancies
    const discrepancyTreasury = Number((db.treasury - stellar.treasury).toFixed(2));
    const discrepancyEscrow = Number((db.escrow - stellar.escrow).toFixed(2));
    const discrepancyVendor = Number((db.vendorSettlement - stellar.vendorSettlement).toFixed(2));
    const discrepancyRevenue = Number((db.revenue - stellar.revenue).toFixed(2));
    const discrepancyAuditReserve = Number((db.auditReserve - stellar.auditReserve).toFixed(2));

    const isMatch = Math.abs(discrepancyTreasury) < 1.0 && 
                    Math.abs(discrepancyEscrow) < 1.0 && 
                    Math.abs(discrepancyVendor) < 1.0 && 
                    Math.abs(discrepancyRevenue) < 1.0 &&
                    Math.abs(discrepancyAuditReserve) < 1.0;

    // 3. Persist the snapshot in MongoDB
    const snapshot = await ReserveSnapshot.create({
      treasuryNT: stellar.treasury,
      escrowNT: stellar.escrow,
      vendorSettlementNT: stellar.vendorSettlement,
      revenueNT: stellar.revenue,
      auditReserveNT: stellar.auditReserve,
      feeReserveXLM: stellar.feeReserveXLM,

      mongodbAvailableKES: db.treasury,
      mongodbLockedKES: db.escrow,
      mongodbVendorSettlementKES: db.vendorSettlement,
      mongodbRevenueKES: db.revenue,
      mongodbAuditReserveKES: db.auditReserve,

      discrepancyTreasury,
      discrepancyEscrow,
      discrepancyVendor,
      discrepancyRevenue,
      discrepancyAuditReserve,
      status: isMatch ? 'match' : 'discrepancy'
    });

    console.log(`[Audit Server] Reserve Snapshot persisted successfully! ID: ${snapshot._id}. Status: ${snapshot.status}`);
    return snapshot;

  } catch (error) {
    console.error("[Audit Server] Error capturing daily Reserve Snapshot:", error);
    throw error;
  }
}

// Automatically schedule the snapshot generation daily at midnight (00:00)
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 0 * * *', async () => {
    try {
      await takeReserveSnapshot();
    } catch (e) {
      console.error("Scheduled Reserve Snapshot failed:", e);
    }
  });
}

module.exports = {
  takeReserveSnapshot
};
