const mongoose = require('mongoose');
require('dotenv').config();
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');

async function reconcile10000() {
  console.log("=======================================================================");
  console.log("🛠️  RECONCILING 10,000 NT TEST TOKEN INFLATION & ALIGNING RESERVES");
  console.log("=======================================================================");

  await mongoose.connect(process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri");
  console.log("Connected to MongoDB.");

  // 1. Flag the test transaction as synced in MongoDB so batch jobs skip it
  const tx = await Transaction.findById('6a81bf983546bd2bd650a826');
  if (tx) {
    tx.settlementStatus = 'synced';
    await tx.save();
    console.log("✅ Updated test transaction 6a81bf983546bd2bd650a826 settlementStatus = 'synced'");
  }

  const platformPublics = stellarTreasuryService.platformWallets;

  // 2. Transfer excess 10,000 NT from Stellar Treasury -> Audit Reserve on-chain
  console.log("\n🔄 Moving 10,000 NT excess test tokens from Stellar Treasury -> Audit Reserve...");
  try {
    const txHashIso = await stellarTreasuryService.performPlatformTransfer(
      platformPublics.treasury.secret,
      platformPublics.auditReserve.public,
      10000,
      "Isolate 10000 NT Test Deposit Inflation"
    );
    console.log(`✅ On-chain isolation hash: ${txHashIso}`);
  } catch (err) {
    console.error("Isolation error:", err.message);
  }

  // 3. Move 7.00 NT from Stellar Treasury -> Stellar Escrow to align Escrow (8.00 NT -> 15.00 NT)
  console.log("\n🔄 Moving 7.00 NT from Stellar Treasury -> Stellar Escrow to match DB Escrow (15 KES)...");
  try {
    const txHashEscrow = await stellarTreasuryService.performPlatformTransfer(
      platformPublics.treasury.secret,
      platformPublics.escrow.public,
      7,
      "Align Escrow to DB Ledger (15 KES)"
    );
    console.log(`✅ On-chain Escrow alignment hash: ${txHashEscrow}`);
  } catch (err) {
    console.error("Escrow alignment error:", err.message);
  }

  // 4. Run Full Reconciliation Audit
  console.log("\nRunning Full Proof-of-Reserves Reconciliation Audit...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 SUCCESS! All Pools are in 100% Perfect 1:1 Alignment (0.00 KES Variance)!");
  } else {
    console.log("⚠️ Audit complete. Review output above.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

reconcile10000().catch(err => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
