require('dotenv').config();
const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const AuditCase = require('../models/AuditCase');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');
const { server } = require('../config/stellarConfig');

async function rebalanceAllPools() {
  console.log("=======================================================================");
  console.log("⚡ DIRECT STELLAR POOL ALIGNMENT & REBALANCE");
  console.log("=======================================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  // 1. Calculate DB Ledgers
  const wallets = await Wallet.find({});
  let dbTreasuryKES = 0;
  let dbEscrowKES = 0;
  let dbVendorSettlementKES = 0;

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

  const commissionTxs = await Transaction.find({ transactionCategory: 'commission', status: 'completed' });
  let dbRevenueKES = commissionTxs.reduce((sum, tx) => sum + parseFloat(tx.amountKES ? tx.amountKES.toString() : '0'), 0);

  const activeCases = await AuditCase.find({ status: { $ne: 'Resolved' } });
  let dbAuditReserveKES = activeCases.reduce((sum, c) => sum + (c.isolatedAmountKES || 0), 0);

  dbTreasuryKES = Number(dbTreasuryKES.toFixed(2));
  dbEscrowKES = Number(dbEscrowKES.toFixed(2));
  dbVendorSettlementKES = Number(dbVendorSettlementKES.toFixed(2));
  dbRevenueKES = Number(dbRevenueKES.toFixed(2));
  dbAuditReserveKES = Number(dbAuditReserveKES.toFixed(2));

  console.log(`\n📋 Target MongoDB Ledger Totals:`);
  console.log(`   - Treasury:          ${dbTreasuryKES.toFixed(2)} KES`);
  console.log(`   - Escrow:            ${dbEscrowKES.toFixed(2)} KES`);
  console.log(`   - Vendor Settlement: ${dbVendorSettlementKES.toFixed(2)} KES`);
  console.log(`   - Platform Revenue:  ${dbRevenueKES.toFixed(2)} KES`);
  console.log(`   - Audit Reserve:     ${dbAuditReserveKES.toFixed(2)} KES`);

  const platformPublics = stellarTreasuryService.platformWallets;
  const NUTRITOKEN_CODE = process.env.NUTRITOKEN_CODE || 'NT';
  const issuerPublic = platformPublics.issuer.public;

  async function getNT(pubKey) {
    if (!pubKey) return 0;
    try {
      const acc = await server.loadAccount(pubKey);
      const b = acc.balances.find(x => x.asset_code === NUTRITOKEN_CODE && x.asset_issuer === issuerPublic);
      return b ? parseFloat(b.balance) : 0;
    } catch (e) {
      return 0;
    }
  }

  // Helper to sync single wallet target
  async function syncWalletPool(name, secret, pubKey, dbTarget) {
    const onChainBal = await getNT(pubKey);
    const diff = Number((dbTarget - onChainBal).toFixed(2));
    console.log(`\n--- Rebalancing ${name} Pool ---`);
    console.log(`   Current On-Chain: ${onChainBal.toFixed(2)} NT | DB Target: ${dbTarget.toFixed(2)} KES | Diff: ${diff.toFixed(2)}`);

    if (Math.abs(diff) < 0.01) {
      console.log(`   ✅ ${name} pool is already in 100% perfect balance.`);
      return;
    }

    if (diff > 0) {
      // Deficit: Mint missing NT from Issuer -> Wallet
      console.log(`   🪙 Minting ${diff.toFixed(2)} NT from Issuer -> ${name}...`);
      await stellarTreasuryService.performPlatformTransfer(
        platformPublics.issuer.secret,
        pubKey,
        diff,
        `Align ${name} deficit with MongoDB ledger`
      );
      console.log(`   ✅ Successfully minted ${diff.toFixed(2)} NT to ${name}.`);
    } else {
      // Excess: Transfer excess NT from Wallet -> Issuer
      const excess = Math.abs(diff);
      console.log(`   🔥 Returning ${excess.toFixed(2)} excess NT from ${name} -> Issuer...`);
      await stellarTreasuryService.performPlatformTransfer(
        secret,
        platformPublics.issuer.public,
        excess,
        `Return ${name} excess NT to Issuer`
      );
      console.log(`   ✅ Successfully returned ${excess.toFixed(2)} NT from ${name} to Issuer.`);
    }
  }

  // Perform Pool Alignments
  await syncWalletPool('Escrow', platformPublics.escrow.secret, platformPublics.escrow.public, dbEscrowKES);
  await syncWalletPool('Vendor Settlement', platformPublics.vendorSettlement.secret, platformPublics.vendorSettlement.public, dbVendorSettlementKES);
  await syncWalletPool('Revenue', platformPublics.revenue.secret, platformPublics.revenue.public, dbRevenueKES);
  await syncWalletPool('Audit Reserve', platformPublics.auditReserve.secret, platformPublics.auditReserve.public, dbAuditReserveKES);
  await syncWalletPool('Treasury', platformPublics.treasury.secret, platformPublics.treasury.public, dbTreasuryKES);

  // Run Audit Report
  console.log("\nRunning Final Proof-of-Reserves Reconciliation Audit...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 SUCCESS! All Stellar Pools & MongoDB Ledger are in 100% PERFECT ALIGNMENT!");
  } else {
    console.log("⚠️ Audit complete. Review status table above.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

rebalanceAllPools().catch(err => {
  console.error("Rebalance error:", err);
  process.exit(1);
});
