const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', MONGO_URI);

  const DeliveryPersonnel = require('../models/DeliveryPersonnel');
  const Delivery = require('../models/Delivery');
  const DeliveryLocation = require('../models/DeliveryLocation');

  // 1. Approved staff
  const staff = await DeliveryPersonnel.find({ approvedStatus: 'approved' }).lean();
  console.log('\n=== APPROVED DELIVERY PERSONNEL ===');
  if (staff.length === 0) {
    console.log('  ⚠️  NO APPROVED DELIVERY PERSONNEL FOUND! Auto-assignment will always fail.');
  } else {
    staff.forEach(s => {
      console.log(`  userId: ${s.user} | Locations: ${JSON.stringify(s.assignedLocations)}`);
    });
  }

  // 2. Delivery locations
  const locs = await DeliveryLocation.find({}).select('hostelResidence _id').lean();
  console.log('\n=== DELIVERY LOCATIONS ===');
  locs.forEach(l => console.log(`  ${l._id} → ${l.hostelResidence}`));

  // 3. Orders that are ready but have no driver
  const unassigned = await Delivery.find({ status: 'ready', deliveryAgent: null })
    .select('_id status deliveryLocation location')
    .lean();
  console.log(`\n=== READY ORDERS WITH NO DRIVER (${unassigned.length}) ===`);
  unassigned.forEach(o => {
    console.log(`  Order ${o._id}: deliveryLocation=${o.deliveryLocation}, location="${o.location}"`);
  });

  // 4. Cross-check: for each unassigned order, is there a matching driver?
  console.log('\n=== CROSS-CHECK: Can each unassigned order be matched? ===');
  for (const o of unassigned) {
    const locId = o.deliveryLocation;
    if (!locId) {
      // Try to resolve from string
      const parts = (o.location || '').trim().split(/\s+/);
      const dl = await DeliveryLocation.findOne({ hostelResidence: new RegExp('^' + parts[0], 'i') });
      if (!dl) {
        console.log(`  Order ${o._id}: ❌ Cannot resolve location "${o.location}" to any DeliveryLocation`);
        continue;
      }
      const driver = await DeliveryPersonnel.findOne({ assignedLocations: dl._id, approvedStatus: 'approved' });
      console.log(`  Order ${o._id}: location string "${o.location}" → resolved to ${dl.hostelResidence} | Driver: ${driver ? '✅ FOUND' : '❌ NONE'}`);
    } else {
      const driver = await DeliveryPersonnel.findOne({ assignedLocations: locId, approvedStatus: 'approved' });
      const locName = locs.find(l => l._id.toString() === locId.toString())?.hostelResidence || locId;
      console.log(`  Order ${o._id}: deliveryLocation="${locName}" | Driver: ${driver ? '✅ FOUND' : '❌ NONE ASSIGNED'}`);
    }
  }

  console.log('\n✅ Diagnostic complete.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
