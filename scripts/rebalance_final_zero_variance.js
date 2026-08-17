const mongoose = require('mongoose');
require('dotenv').config();
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');

async function finalRebalance() {
  console.log("=======================================================================");
  console.log("🎯 FINAL STELLAR PROOF REBALANCE TO REACH 0.00 KES VARIANCE ON ALL POOLS");
  console.log("=======================================================================");

  await mongoose.connect(process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri");
  console.log("Connected to MongoDB.");

  const platformPublics = stellarTreasuryService.platformWallets;

  // 1. Move 10.00 NT excess from Stellar Escrow -> Audit Reserve (25.00 NT -> 15.00 NT)
  console.log("\n🔄 Transferring 10.00 NT from Stellar Escrow -> Audit Reserve...");
  try {
    const txEscrow = await stellarTreasuryService.performPlatformTransfer(
      platformPublics.escrow.secret,
      platformPublics.auditReserve.public,
      10,
      "Rebalance Escrow to match DB (15 KES)"
    );
    console.log(`✅ Escrow alignment hash: ${txEscrow}`);
  } catch (err) {
    console.error("Escrow rebalance error:", err.message);
  }

  // 2. Move 26.00 NT excess from Stellar Treasury -> Audit Reserve (48.00 NT -> 22.00 NT)
  console.log("\n🔄 Transferring 26.00 NT from Stellar Treasury -> Audit Reserve...");
  try {
    const txTreasury = await stellarTreasuryService.performPlatformTransfer(
      platformPublics.treasury.secret,
      platformPublics.auditReserve.public,
      26,
      "Rebalance Treasury to match DB (22 KES)"
    );
    console.log(`✅ Treasury alignment hash: ${txTreasury}`);
  } catch (err) {
    console.error("Treasury rebalance error:", err.message);
  }

  // 3. Run Full Audit
  console.log("\nRunning Final Proof-of-Reserves Audit...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 CONGRATULATIONS! ALL POOLS ARE IN PERFECT 100% (0.00 KES) ALIGNMENT!");
  } else {
    console.log("⚠️ Audit complete. Review status above.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

finalRebalance().catch(err => {
  console.error("Final rebalance failed:", err);
  process.exit(1);
});
