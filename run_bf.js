const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const User = require('./models/User');
const Transaction = require('./models/Transaction');
const CustomOrder = require('./models/CustomOrder');
const Subscription = require('./models/Subscription');
const LoyaltyLog = require('./models/LoyaltyLog');
const { calculatePoints, awardPoints } = require('./services/loyaltyService');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
  console.log('Database connected.');

  // Find all users who placed orders or transactions >= 100 KES
  const users = await User.find({ role: 'student' });
  console.log(`Checking ${users.length} student user(s)...`);

  for (const user of users) {
    // Find all custom orders >= 100 KES
    const orders = await CustomOrder.find({ user: user._id, totalCost: { $gte: 100 } });
    for (const order of orders) {
      const existing = await LoyaltyLog.findOne({ userId: user._id, orderId: order._id, type: 'earned' });
      if (!existing) {
        console.log(`Awarding points for CustomOrder ${order.orderId} (KES ${order.totalCost}) to User ${user._id}`);
        await awardPoints({ userId: user._id, orderId: order._id, orderAmountKES: order.totalCost });
      }
    }

    // Find all subscriptions >= 100 KES
    const subs = await Subscription.find({ student: user._id, totalPaidKES: { $gte: 100 } });
    for (const sub of subs) {
      const existing = await LoyaltyLog.findOne({ userId: user._id, orderId: sub._id, type: 'earned' });
      if (!existing) {
        console.log(`Awarding points for Subscription ${sub._id} (KES ${sub.totalPaidKES}) to User ${user._id}`);
        await awardPoints({ userId: user._id, orderId: sub._id, orderAmountKES: sub.totalPaidKES });
      }
    }

    // Find all transactions >= 100 KES where fromUser is user._id
    const txs = await Transaction.find({ fromUser: user._id, status: 'completed', amountKES: { $gte: 100 } });
    for (const tx of txs) {
      const amt = parseFloat(tx.amountKES.toString());
      if (amt < 100) continue;
      const existing = await LoyaltyLog.findOne({ userId: user._id, orderAmountKES: amt });
      if (!existing) {
        console.log(`Awarding points for Transaction ${tx.transactionId} (KES ${amt}) to User ${user._id}`);
        await awardPoints({ userId: user._id, orderId: null, orderAmountKES: amt });
      }
    }

    const updatedUser = await User.findById(user._id);
    console.log(`User ${user.email} (${user._id}): Current Loyalty Points = ${updatedUser.loyaltyPoints}, Total Earned = ${updatedUser.totalLoyaltyPointsEarned}, Converted = ${updatedUser.totalLoyaltyPointsConverted}`);
  }

  await mongoose.disconnect();
  console.log('Backfill finished.');
}

main().catch(err => {
  console.error('Backfill Error:', err);
  mongoose.disconnect();
});
