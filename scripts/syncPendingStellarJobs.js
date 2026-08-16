const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('../services/stellarTreasuryService');
require('dotenv').config();

async function syncPendingStellar() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully!");

    // 1. Find all pending or failed transactions
    const pendingTxs = await Transaction.find({
      $or: [
        { settlementStatus: 'pending' },
        { settlementStatus: 'failed' }
      ]
    });

    console.log(`Found ${pendingTxs.length} pending/failed transaction(s) to sync to Stellar...`);

    for (const tx of pendingTxs) {
      const amount = parseFloat(tx.amountKES ? tx.amountKES.toString() : '0');
      if (amount <= 0) continue;

      let hash = "";
      try {
        if (tx.transactionCategory === 'mpesa_direct_order' || tx.transactionCategory === 'deposit') {
          console.log(`Minting ${amount} NT for transaction ${tx._id}...`);
          hash = await stellarTreasuryService.mintNT(amount);
          
          // If orderType === 'custom' or category is custom order, lock to Escrow
          if (tx.orderType === 'custom' || tx.transactionCategory === 'mpesa_direct_order') {
            console.log(`Locking ${amount} NT to Escrow on-chain...`);
            await stellarTreasuryService.settleToEscrow(amount);
          }
        } else if (tx.transactionCategory === 'subscription_lock' || tx.transactionCategory === 'custom_order') {
          console.log(`Locking ${amount} NT to Escrow...`);
          hash = await stellarTreasuryService.settleToEscrow(amount);
        } else if (tx.transactionCategory === 'escrow_release') {
          console.log(`Releasing ${amount} NT to Vendor Settlement...`);
          hash = await stellarTreasuryService.releaseVendorSettlement(amount);
        } else if (tx.transactionCategory === 'commission') {
          console.log(`Recording ${amount} NT to Platform Revenue...`);
          hash = await stellarTreasuryService.recordRevenue(amount);
        }

        if (hash) {
          tx.stellarTxHash = hash;
          tx.settlementStatus = 'synced';
          await tx.save();
          console.log(`✅ Synced transaction ${tx._id}. Hash: ${hash}`);
        }
      } catch (err) {
        console.error(`⚠️ Failed to sync tx ${tx._id}:`, err.message);
      }
    }

    console.log("\n=======================================================");
    console.log("🎉 STELLAR SYNC COMPLETED!");
    console.log("=======================================================\n");

  } catch (error) {
    console.error("❌ Sync failed:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

syncPendingStellar();
