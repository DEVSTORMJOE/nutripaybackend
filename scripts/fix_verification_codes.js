const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay').then(async () => {
  const Delivery = require('../models/Delivery');

  const orders = await Delivery.find({
    status: { $in: ['assigned', 'picked_up', 'ready'] }
  }).select('_id status deliveryVerificationCode deliveryAgent location deliveryLocation').lean();

  console.log(`\n=== ACTIVE ORDERS (${orders.length}) ===`);
  orders.forEach(o => {
    console.log(`  ${o._id}`);
    console.log(`    status: ${o.status}`);
    console.log(`    location: "${o.location}"`);
    console.log(`    deliveryAgent: ${o.deliveryAgent}`);
    console.log(`    deliveryVerificationCode: ${o.deliveryVerificationCode || '❌ MISSING'}`);
    console.log();
  });

  // Backfill missing verification codes on assigned orders
  const missing = orders.filter(o => !o.deliveryVerificationCode);
  if (missing.length > 0) {
    console.log(`[Backfill] Generating verification codes for ${missing.length} orders...`);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (const o of missing) {
      const part1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const code = `NP-${part1}-${part2}`;
      const expiry = new Date();
      expiry.setHours(23, 59, 59, 999);

      await Delivery.updateOne({ _id: o._id }, {
        deliveryVerificationCode: code,
        deliveryVerificationExpiry: expiry
      });
      console.log(`  ✅ Order ${o._id} → code: ${code}`);
    }
  } else {
    console.log('All active orders already have verification codes.');
  }

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
