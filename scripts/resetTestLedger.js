const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const CustomOrder = require('../models/CustomOrder');
const NDashOrder = require('../models/NDashOrder');
require('dotenv').config();

async function resetTestLedger() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully!");

    console.log("\n🧹 Clearing test transaction & order history...");

    const delTx = await Transaction.deleteMany({});
    console.log(`- Deleted ${delTx.deletedCount} Transaction records.`);

    const delDel = await Delivery.deleteMany({});
    console.log(`- Deleted ${delDel.deletedCount} Delivery records.`);

    const delCustom = await CustomOrder.deleteMany({});
    console.log(`- Deleted ${delCustom.deletedCount} CustomOrder records.`);

    const delNDash = await NDashOrder.deleteMany({});
    console.log(`- Deleted ${delNDash.deletedCount} NDashOrder records.`);

    try {
      const LedgerEntry = require('../models/LedgerEntry');
      const delLedger = await LedgerEntry.deleteMany({});
      console.log(`- Deleted ${delLedger.deletedCount} LedgerEntry records.`);
    } catch (_) {
      // LedgerEntry model not present or empty
    }

    console.log("\n💳 Resetting all user and vendor wallet balances to KES 0...");
    const resetResult = await Wallet.updateMany({}, {
      $set: {
        availableBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
        lockedBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
        tokenBalanceNT: mongoose.Types.Decimal128.fromString("0.00"),
        totalSpentKES: mongoose.Types.Decimal128.fromString("0.00"),
        walletFundingSources: []
      }
    });
    console.log(`- Reset ${resetResult.modifiedCount} Wallets back to KES 0.00 / 0.00 NT.`);

    console.log("\n=======================================================");
    console.log("🎉 TEST LEDGER RESET COMPLETED SUCCESSFULLY!");
    console.log("User accounts, vendors, meals, and menus remain 100% intact.");
    console.log("=======================================================\n");

  } catch (error) {
    console.error("❌ Reset failed:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

resetTestLedger();
