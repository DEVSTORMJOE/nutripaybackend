const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay').then(async () => {
  const Student = require('../models/Student');
  const DeliveryPersonnel = require('../models/DeliveryPersonnel');
  const DeliveryLocation = require('../models/DeliveryLocation');
  const User = require('../models/User');
  const Delivery = require('../models/Delivery');

  // ── Driver check ──────────────────────────────────────────────────────────
  const driverUser = await User.findOne({ email: 'driver_111@nutripay.local' }).lean();
  console.log('\n=== DRIVER USER ===');
  console.log(driverUser ? `  _id: ${driverUser._id}  name: ${driverUser.name}  email: ${driverUser.email}` : '  ❌ Not found');

  let dp = null;
  if (driverUser) {
    dp = await DeliveryPersonnel.findOne({ user: driverUser._id }).lean();
    console.log('\n=== DELIVERY PERSONNEL RECORD ===');
    if (dp) {
      console.log(`  _id: ${dp._id}`);
      console.log(`  approvedStatus: ${dp.approvedStatus}`);
      console.log(`  assignedLocations: ${JSON.stringify(dp.assignedLocations)}`);
    } else {
      console.log('  ❌ No DeliveryPersonnel record found for this driver user!');
    }

    if (dp && dp.assignedLocations && dp.assignedLocations.length > 0) {
      const locs = await DeliveryLocation.find({ _id: { $in: dp.assignedLocations } }).lean();
      console.log('\n=== DRIVER ASSIGNED DELIVERY LOCATIONS ===');
      locs.forEach(l => console.log(`  ${l._id}  →  ${l.hostelResidence}`));
    }
  }

  // ── Student check ─────────────────────────────────────────────────────────
  const studentUser = await User.findOne({ name: /vanidiah/i }).lean();
  console.log('\n=== STUDENT USER (Vanidiah) ===');
  if (studentUser) {
    console.log(`  _id: ${studentUser._id}  name: ${studentUser.name}  email: ${studentUser.email}`);
  } else {
    console.log('  ❌ Not found — checking by studentId...');
  }

  let sp = null;
  if (studentUser) {
    sp = await Student.findOne({ user: studentUser._id }).lean();
  } else {
    sp = await Student.findOne({ studentId: 'ST-2026-9158' }).lean();
  }
  console.log('\n=== STUDENT PROFILE ===');
  if (sp) {
    console.log(`  studentId: ${sp.studentId}`);
    console.log(`  hostel: "${sp.hostel}"`);
    console.log(`  deliveryLocation (ObjectId): ${sp.deliveryLocation}`);
    console.log(`  block: ${sp.block}  room: ${sp.room}  floor: ${sp.floor}`);
    console.log(`  campus: ${sp.campus}  university: ${sp.university}`);
  } else {
    console.log('  ❌ No Student profile found');
  }

  // ── Recent orders ─────────────────────────────────────────────────────────
  const userId = studentUser?._id || sp?.user;
  if (userId) {
    const orders = await Delivery.find({ student: userId }).sort({ createdAt: -1 }).limit(5).lean();
    console.log(`\n=== RECENT DELIVERY ORDERS (${orders.length}) ===`);
    orders.forEach(o => {
      console.log(`  ${o._id}  status=${o.status}  deliveryLocation=${o.deliveryLocation}  location="${o.location}"  agent=${o.deliveryAgent}`);
    });
  }

  // ── CBD DeliveryLocation ──────────────────────────────────────────────────
  const cbdLoc = await DeliveryLocation.findOne({ hostelResidence: /CBD/i }).lean();
  console.log('\n=== CBD DELIVERY LOCATION ===');
  if (cbdLoc) {
    console.log(`  _id: ${cbdLoc._id}  hostelResidence: ${cbdLoc.hostelResidence}`);
    // Check if driver is assigned to it
    if (dp) {
      const matched = (dp.assignedLocations || []).some(l => l.toString() === cbdLoc._id.toString());
      console.log(`  Driver assigned to CBD? ${matched ? '✅ YES' : '❌ NO'}`);
    }
  } else {
    console.log('  ❌ No DeliveryLocation with hostelResidence matching "CBD"');
  }

  // ── Cross-check: can student be matched? ─────────────────────────────────
  console.log('\n=== AUTO-ASSIGNMENT CROSS-CHECK ===');
  if (sp) {
    const locId = sp.deliveryLocation;
    const hostel = sp.hostel;
    if (locId) {
      const driver = dp ? (dp.assignedLocations || []).some(l => l.toString() === locId.toString()) : false;
      const locName = cbdLoc && cbdLoc._id.toString() === locId.toString() ? cbdLoc.hostelResidence : locId;
      console.log(`  Student has deliveryLocation ObjectId: ${locId} (${locName})`);
      console.log(`  Driver assigned to that location? ${driver ? '✅ YES — auto-assign should work!' : '❌ NO — driver not linked to this location'}`);
    } else {
      console.log(`  Student deliveryLocation is NULL. Hostel string: "${hostel}"`);
      // Try to resolve
      const dl = await DeliveryLocation.findOne({ hostelResidence: new RegExp(hostel.trim(), 'i') }).lean();
      if (dl) {
        console.log(`  ✅ Hostel string "${hostel}" resolves to DeliveryLocation: ${dl._id} (${dl.hostelResidence})`);
        if (dp) {
          const driver = (dp.assignedLocations || []).some(l => l.toString() === dl._id.toString());
          console.log(`  Driver assigned to "${dl.hostelResidence}"? ${driver ? '✅ YES — fallback match works!' : '❌ NO'}`);
        }
      } else {
        console.log(`  ❌ Cannot resolve hostel "${hostel}" to any DeliveryLocation`);
        const allLocs = await DeliveryLocation.find({}).lean();
        console.log(`  Available DeliveryLocations: ${allLocs.map(l => l.hostelResidence).join(', ')}`);
      }
    }
  }

  console.log('\n✅ Done.');
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
