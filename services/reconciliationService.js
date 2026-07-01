const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('./stellarTreasuryService');
const { Horizon } = require('stellar-sdk');

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);
const NUTRITOKEN_CODE = process.env.NUTRITOKEN_CODE || 'NT';
const issuerPublic = stellarTreasuryService.platformWallets.issuer.public;

/**
 * Utility to fetch on-chain NT balance of a specific Stellar public key
 */
async function getOnChainNTBalance(publicKey) {
  if (!publicKey) return 0;
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find(
      b => b.asset_code === NUTRITOKEN_CODE && b.asset_issuer === issuerPublic
    );
    return native ? parseFloat(native.balance) : 0;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.warn(`[Audit Server] Account ${publicKey} is not activated on Stellar.`);
    } else {
      console.error(`[Audit Server] Error fetching balance for ${publicKey}:`, error.message);
    }
    return 0;
  }
}

/**
 * Reconciles the primary MongoDB operational ledger against the on-chain Stellar proof-of-reserve layer
 */
async function runFullReconciliation() {
  console.log("\n=======================================================================");
  console.log("🛡️  NUTRIPAY PROOF-OF-RESERVES & LEDGER RECONCILIATION AUDIT");
  console.log("=======================================================================");
  
  try {
    // 1. Calculate Aggregated Local MongoDB Balances
    const wallets = await Wallet.find({});
    
    let dbTreasuryKES = 0;        // Spendable credit pools for students/sponsors
    let dbEscrowKES = 0;          // Active locked subscription escrows
    let dbVendorSettlementKES = 0; // Unwithdrawn earnings for vendors
    
    wallets.forEach(w => {
      const avail = parseFloat(w.availableBalanceKES ? w.availableBalanceKES.toString() : '0');
      const locked = parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0');
      if (w.walletType === 'student' || w.walletType === 'sponsor') {
        dbTreasuryKES += avail;
      }
      if (w.walletType === 'student') {
        dbEscrowKES += locked;
      }
      if (w.walletType === 'vendor') {
        dbVendorSettlementKES += avail;
      }
    });

    dbTreasuryKES = Number(dbTreasuryKES.toFixed(2));
    dbEscrowKES = Number(dbEscrowKES.toFixed(2));
    dbVendorSettlementKES = Number(dbVendorSettlementKES.toFixed(2));

    // Calculate Platform Revenue from MongoDB transaction logs (sum category === 'commission')
    const commissionTxs = await Transaction.find({ transactionCategory: 'commission', status: 'completed' });
    let dbRevenueKES = commissionTxs.reduce((sum, tx) => sum + parseFloat(tx.amountKES ? tx.amountKES.toString() : '0'), 0);
    dbRevenueKES = Number(dbRevenueKES.toFixed(2));

    // 2. Query On-Chain NT Token Balances
    const platformPublics = stellarTreasuryService.platformWallets;
    
    const onChainTreasuryNT = await getOnChainNTBalance(platformPublics.treasury.public);
    const onChainEscrowNT = await getOnChainNTBalance(platformPublics.escrow.public);
    const onChainVendorSettlementNT = await getOnChainNTBalance(platformPublics.vendorSettlement.public);
    const onChainRevenueNT = await getOnChainNTBalance(platformPublics.revenue.public);

    // 3. Perform Reserve Accuracy Audits
    const treasuryDiff = Math.abs(dbTreasuryKES - onChainTreasuryNT);
    const escrowDiff = Math.abs(dbEscrowKES - onChainEscrowNT);
    const vendorDiff = Math.abs(dbVendorSettlementKES - onChainVendorSettlementNT);
    const revenueDiff = Math.abs(dbRevenueKES - onChainRevenueNT);

    const checkPassed = (diff) => diff < 1.0; // Enforce tolerance within 1 KES due to rounding splits

    console.log("\n📊 AUDIT COMPARISON SHEET (1 NT = 1 KES):");
    console.log("-----------------------------------------------------------------------");
    console.log(`🏛️  Treasury Reserves (User Available Pool):`);
    console.log(`   - MongoDB Ledger:   ${dbTreasuryKES.toFixed(2)} KES`);
    console.log(`   - Stellar Proof:    ${onChainTreasuryNT.toFixed(2)} NT`);
    console.log(`   - Status:           ${checkPassed(treasuryDiff) ? '✅ MATCH' : '⚠️ DISCREPANCY (' + (dbTreasuryKES - onChainTreasuryNT).toFixed(2) + ')'}`);
    console.log("-----------------------------------------------------------------------");
    console.log(`🔒 Escrow Reserves (Locked Subscriptions):`);
    console.log(`   - MongoDB Ledger:   ${dbEscrowKES.toFixed(2)} KES`);
    console.log(`   - Stellar Proof:    ${onChainEscrowNT.toFixed(2)} NT`);
    console.log(`   - Status:           ${checkPassed(escrowDiff) ? '✅ MATCH' : '⚠️ DISCREPANCY (' + (dbEscrowKES - onChainEscrowNT).toFixed(2) + ')'}`);
    console.log("-----------------------------------------------------------------------");
    console.log(`🏪 Vendor Settlement (Released Earnings):`);
    console.log(`   - MongoDB Ledger:   ${dbVendorSettlementKES.toFixed(2)} KES`);
    console.log(`   - Stellar Proof:    ${onChainVendorSettlementNT.toFixed(2)} NT`);
    console.log(`   - Status:           ${checkPassed(vendorDiff) ? '✅ MATCH' : '⚠️ DISCREPANCY (' + (dbVendorSettlementKES - onChainVendorSettlementNT).toFixed(2) + ')'}`);
    console.log("-----------------------------------------------------------------------");
    console.log(`📈 Platform Revenue (Commissions):`);
    console.log(`   - MongoDB Ledger:   ${dbRevenueKES.toFixed(2)} KES`);
    console.log(`   - Stellar Proof:    ${onChainRevenueNT.toFixed(2)} NT`);
    console.log(`   - Status:           ${checkPassed(revenueDiff) ? '✅ MATCH' : '⚠️ DISCREPANCY (' + (dbRevenueKES - onChainRevenueNT).toFixed(2) + ')'}`);
    console.log("=======================================================================");

    const overallSuccess = checkPassed(treasuryDiff) && checkPassed(escrowDiff) && checkPassed(vendorDiff) && checkPassed(revenueDiff);
    return {
      success: overallSuccess,
      db: { treasury: dbTreasuryKES, escrow: dbEscrowKES, vendorSettlement: dbVendorSettlementKES, revenue: dbRevenueKES },
      stellar: { treasury: onChainTreasuryNT, escrow: onChainEscrowNT, vendorSettlement: onChainVendorSettlementNT, revenue: onChainRevenueNT }
    };

  } catch (error) {
    console.error("❌ Ledger Reconciliation Audit Failed with error:", error);
    throw error;
  }
}

module.exports = {
  runFullReconciliation,
  validateWalletInternalConsistency,
  generateReconciliationReport
};

/**
 * Validates that every wallet satisfies:
 *   availableBalanceKES + lockedBalanceKES === tokenBalanceNT (within 0.01 KES tolerance)
 */
async function validateWalletInternalConsistency() {
  const wallets = await Wallet.find({}).populate('user', 'name email');
  const mismatches = [];

  for (const w of wallets) {
    const avail = parseFloat(w.availableBalanceKES ? w.availableBalanceKES.toString() : '0');
    const locked = parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0');
    const tokenBal = parseFloat(w.tokenBalanceNT ? w.tokenBalanceNT.toString() : '0');

    const computed = Number((avail + locked).toFixed(2));
    const diff = Math.abs(computed - tokenBal);
    if (diff > 0.01) {
      mismatches.push({
        userId: w.user?._id || w.user,
        username: w.user?.name || 'N/A',
        email: w.user?.email || 'N/A',
        walletType: w.walletType,
        tokenBalanceNT: tokenBal,
        availableBalanceKES: avail,
        lockedBalanceKES: locked,
        computedTotal: computed,
        discrepancyKES: Number((computed - tokenBal).toFixed(2))
      });
    }
  }

  if (mismatches.length > 0) {
    console.warn(`[Reconciliation] WARNING: ${mismatches.length} wallet(s) fail internal consistency (available + locked != tokenBalanceNT).`);
  } else {
    console.log(`[Reconciliation] All ${wallets.length} wallets pass internal consistency check.`);
  }

  return { valid: mismatches.length === 0, totalChecked: wallets.length, mismatches };
}

/**
 * Generates a full financial reconciliation report (internal + Stellar cross-chain)
 */
async function generateReconciliationReport() {
  const timestamp = new Date();
  const internalCheck = await validateWalletInternalConsistency();

  let stellarReconciliation = null;
  try {
    stellarReconciliation = await runFullReconciliation();
  } catch (err) {
    stellarReconciliation = { success: false, error: err.message };
  }

  const wallets = await Wallet.find({});
  const stats = {
    totalWallets: wallets.length,
    totalAvailableKES: Number(wallets.reduce((s, w) => s + parseFloat(w.availableBalanceKES ? w.availableBalanceKES.toString() : '0'), 0).toFixed(2)),
    totalLockedKES: Number(wallets.reduce((s, w) => s + parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0'), 0).toFixed(2)),
    totalTokenBalanceNT: Number(wallets.reduce((s, w) => s + parseFloat(w.tokenBalanceNT ? w.tokenBalanceNT.toString() : '0'), 0).toFixed(2)),
    byType: {
      student: wallets.filter(w => w.walletType === 'student').length,
      vendor: wallets.filter(w => w.walletType === 'vendor').length,
      sponsor: wallets.filter(w => w.walletType === 'sponsor').length,
      admin: wallets.filter(w => w.walletType === 'admin').length,
    }
  };

  const RefundRequest = require('../models/RefundRequest');
  const pendingRefunds = await RefundRequest.find({ status: 'pending_admin_approval' }).lean();
  const totalPendingRefundKES = pendingRefunds.reduce((s, r) => s + parseFloat(r.amountKES ? r.amountKES.toString() : '0'), 0);

  return {
    generatedAt: timestamp,
    overallHealthy: internalCheck.valid && (stellarReconciliation && stellarReconciliation.success !== false),
    internalConsistency: internalCheck,
    stellarReserves: stellarReconciliation,
    walletStats: stats,
    pendingRefunds: { count: pendingRefunds.length, totalAmountKES: totalPendingRefundKES }
  };
}
