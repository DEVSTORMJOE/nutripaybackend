const mongoose = require('mongoose');
const fs = require('fs');
const User = require('./models/User');
const CustomOrder = require('./models/CustomOrder');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nutripay');
  
  const recentOrders = await CustomOrder.find({}).sort({ createdAt: -1 }).limit(10).lean();
  let out = "=== RECENT ORDERS ===\n";
  for (const o of recentOrders) {
    const user = await User.findById(o.user).lean();
    out += `Order ${o.orderId} | Amount: KES ${o.totalCost} | PayMethod: ${o.paymentMethod} | Status: ${o.status} | User: ${user?.email} (${user?.name}) | Points: ${user?.loyaltyPoints} | Date: ${o.createdAt}\n`;
  }
  fs.writeFileSync('orders_out.txt', out);
  console.log("Wrote orders_out.txt");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
