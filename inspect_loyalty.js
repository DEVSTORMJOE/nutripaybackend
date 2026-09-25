const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const User = require('./models/User');
const LoyaltyLog = require('./models/LoyaltyLog');
const CustomOrder = require('./models/CustomOrder');
const Transaction = require('./models/Transaction');

const fs = require('fs');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
  let logStr = 'Database connected.\n';

  const users = await User.find().select('email name loyaltyPoints totalLoyaltyPointsEarned totalLoyaltyPointsConverted');
  logStr += '=== USERS LOYALTY SUMMARY ===\n';
  for (let u of users) {
    const logsCount = await LoyaltyLog.countDocuments({ userId: u._id });
    if (u.totalLoyaltyPointsEarned > 0 || logsCount > 0 || u.loyaltyPoints > 0) {
      logStr += `User: ${u.email} (${u.name}) - ID: ${u._id}\n`;
      logStr += `  Points: ${u.loyaltyPoints}, Total Earned: ${u.totalLoyaltyPointsEarned}, Converted: ${u.totalLoyaltyPointsConverted}, Logs: ${logsCount}\n`;
      const recentLogs = await LoyaltyLog.find({ userId: u._id }).sort({ createdAt: -1 }).limit(10);
      recentLogs.forEach(l => {
        logStr += `    - [${l.type}] ${l.points} pts | KES ${l.orderAmountKES} | ${l.description} | ${l.createdAt}\n`;
      });
    }
  }

  logStr += '\n=== RECENT CUSTOM ORDERS ===\n';
  const recentOrders = await CustomOrder.find().sort({ createdAt: -1 }).limit(10);
  recentOrders.forEach(o => {
    logStr += `Order: ${o.orderId || o._id} | User: ${o.user} | KES ${o.totalCost} | Status: ${o.status} | PayMethod: ${o.paymentMethod} | Date: ${o.createdAt}\n`;
  });

  logStr += '\n=== RECENT TRANSACTIONS ===\n';
  const recentTxs = await Transaction.find().sort({ createdAt: -1 }).limit(10);
  recentTxs.forEach(t => {
    logStr += `Tx: ${t.transactionId} | From: ${t.fromUser} | To: ${t.toUser} | KES ${t.amountKES} | Cat: ${t.transactionCategory} | Status: ${t.status} | Date: ${t.createdAt}\n`;
  });

  fs.writeFileSync('./inspect_out.txt', logStr, 'utf8');
  console.log('Wrote inspect_out.txt successfully');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  mongoose.disconnect();
});
