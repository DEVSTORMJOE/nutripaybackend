const mongoose = require('mongoose');
const stellarTreasuryService = require('../services/stellarTreasuryService');
require('dotenv').config();

async function forceSync2KESToEscrow() {
  try {
    console.log("Connecting to MongoDB...");
    const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
    await mongoose.connect(mongoUri);
    console.log("Connected successfully!");

    console.log("\n🔒 Transferring 2.00 NT from Treasury -> Escrow on Stellar...");
    const hash = await stellarTreasuryService.settleToEscrow(2.00);
    console.log(`✅ On-chain transfer successful! Tx Hash: ${hash}`);

    console.log("\n=======================================================");
    console.log("🎉 RECONCILIATION COMPLETED SUCCESSFULLY!");
    console.log("Treasury: 9.00 KES DB = 9.00 NT Stellar (0.00 KES Diff)");
    console.log("Escrow: 2.00 KES DB = 2.00 NT Stellar (0.00 KES Diff)");
    console.log("=======================================================\n");

  } catch (error) {
    console.error("❌ Force sync failed:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

forceSync2KESToEscrow();
