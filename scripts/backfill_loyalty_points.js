const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config({ path: "../.env" });

const User = require("../models/User");
const Transaction = require("../models/Transaction");
const CustomOrder = require("../models/CustomOrder");
const Subscription = require("../models/Subscription");
const LoyaltyLog = require("../models/LoyaltyLog");
const { calculatePoints, awardPoints } = require("../services/loyaltyService");

async function runBackfill() {
  console.log("=== Backfilling Loyalty Points for Past Completed Orders ===");

  const dbUri = process.env.MONGO_URI || "mongodb://localhost:27017/nutripay";
  await mongoose.connect(dbUri);
  console.log("Connected to database...");

  // 1. Scan Custom Orders >= 100 KES
  const customOrders = await CustomOrder.find({
    status: { $in: ["preparing", "ready", "delivered"] },
    totalCost: { $gte: 100 },
  }).lean();

  console.log(`Found ${customOrders.length} completed custom order(s) >= 100 KES.`);

  let awardedCount = 0;
  for (const order of customOrders) {
    if (!order.user) continue;
    // Check if points were already logged for this order
    const existingLog = await LoyaltyLog.findOne({
      userId: order.user,
      orderId: order._id,
      type: "earned",
    });

    if (!existingLog) {
      console.log(`Backfilling points for Custom Order ${order.orderId || order._id} (KES ${order.totalCost}) for User ${order.user}...`);
      await awardPoints({
        userId: order.user,
        orderId: order._id,
        orderAmountKES: order.totalCost,
      });
      awardedCount++;
    }
  }

  // 2. Scan Subscriptions >= 100 KES
  const subscriptions = await Subscription.find({
    status: { $in: ["active", "completed"] },
    totalPaidKES: { $gte: 100 },
  }).lean();

  console.log(`Found ${subscriptions.length} active/completed subscription(s) >= 100 KES.`);

  for (const sub of subscriptions) {
    if (!sub.student) continue;
    const existingLog = await LoyaltyLog.findOne({
      userId: sub.student,
      orderId: sub._id,
      type: "earned",
    });

    if (!existingLog) {
      console.log(`Backfilling points for Subscription ${sub._id} (KES ${sub.totalPaidKES}) for Student ${sub.student}...`);
      await awardPoints({
        userId: sub.student,
        orderId: sub._id,
        orderAmountKES: sub.totalPaidKES,
      });
      awardedCount++;
    }
  }

  // 3. Scan general debit transactions >= 100 KES (e.g. custom_order, ndash_payment, escrow_lock) without logged loyalty
  const debitTxs = await Transaction.find({
    status: "completed",
    transactionCategory: { $in: ["custom_order", "mpesa_direct_order", "funding", "ndash_payment"] },
    amountKES: { $gte: 100 },
    fromUser: { $ne: null },
  }).lean();

  console.log(`Found ${debitTxs.length} debit transaction(s) >= 100 KES.`);

  for (const tx of debitTxs) {
    const userId = tx.fromUser;
    if (!userId) continue;
    const amount = parseFloat(tx.amountKES ? tx.amountKES.toString() : "0");
    if (amount < 100) continue;

    const txTime = new Date(tx.createdAt || Date.now()).getTime();
    const existingLog = await LoyaltyLog.findOne({
      userId: userId,
      orderAmountKES: amount,
      createdAt: {
        $gte: new Date(txTime - 5000),
        $lte: new Date(txTime + 5000),
      },
    });

    if (!existingLog) {
      console.log(`Backfilling points for Transaction ${tx.transactionId} (KES ${amount}) for User ${userId}...`);
      await awardPoints({
        userId,
        orderId: null,
        orderAmountKES: amount,
      });
      awardedCount++;
    }
  }

  console.log(`\n✅ Loyalty points backfill complete! Awarded points for ${awardedCount} past order(s)/transaction(s).`);
  await mongoose.disconnect();
}

runBackfill().catch((err) => {
  console.error("Backfill error:", err);
  mongoose.disconnect();
});
