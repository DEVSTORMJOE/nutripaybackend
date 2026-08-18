const mongoose = require('mongoose');
require('dotenv').config();
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');

async function reconcileTreasuryAndEscrow() {
  console.log("=======================================================================");
  console.log("🛡️  NUTRIPAY STELLAR PROOF-OF-RESERVES RECONCILIATION AUDIT (207 NT)");
  console.log("=======================================================================");

  const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");

  const AMOUNT_TO_REBALANCE = 207.00;

  console.log(`\n🔄 Transferring ${AMOUNT_TO_REBALANCE.toFixed(2)} NT from Stellar Treasury -> Stellar Escrow...`);

  try {
    const txHash = await stellarTreasuryService.performPlatformTransfer(
      stellarTreasuryService.platformWallets.treasury.secret,
      stellarTreasuryService.platformWallets.escrow.public,
      AMOUNT_TO_REBALANCE,
      `Rebalance Treasury to Escrow discrepancy (${AMOUNT_TO_REBALANCE} NT)`
    );
    console.log(`✅ Stellar transfer completed successfully! Tx Hash: ${txHash}`);
  } catch (err) {
    console.error("❌ On-chain transfer error:", err.message);
  }

  console.log("\n Running Full Proof-of-Reserves Reconciliation Audit...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 SUCCESS! Stellar Escrow and Treasury are in 100% Alignment (0.00 KES Variance)!");
  } else {
    console.log("⚠️ Audit complete. Review status output above.");
  }
  console.log("=======================================================================");

  await mongoose.disconnect();
  process.exit(0);
}

reconcileTreasuryAndEscrow().catch(err => {
  console.error("❌ Rebalance script error:", err);
  process.exit(1);
});
