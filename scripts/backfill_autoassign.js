/**
 * Backfill script: Resolves deliveryLocation for students with hostel text but null deliveryLocation,
 * then re-triggers auto-assignment for existing 'ready' orders that have no deliveryAgent.
 * 
 * SAFE: Does not delete any data. Only updates null fields and assigns drivers.
 */
const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay').then(async () => {
  const Student = require('../models/Student');
  const DeliveryPersonnel = require('../models/DeliveryPersonnel');
  const DeliveryLocation = require('../models/DeliveryLocation');
  const Delivery = require('../models/Delivery');

  const allLocs = await DeliveryLocation.find({}).lean();
  const allApprovedStaff = await DeliveryPersonnel.find({ approvedStatus: 'approved' }).lean();
  
  console.log(`Delivery Locations: ${allLocs.map(l => `${l._id}=${l.hostelResidence}`).join(', ')}`);
  console.log(`Approved Staff: ${allApprovedStaff.length}`);

  // ── Step 1: Fix students with hostel text but null deliveryLocation ────────
  const studentsToFix = await Student.find({ deliveryLocation: null, hostel: { $nin: ['', null, 'Campus'] } }).lean();
  console.log(`\n[Step 1] Students with hostel text but null deliveryLocation: ${studentsToFix.length}`);

  for (const s of studentsToFix) {
    const dl = allLocs.find(l =>
      new RegExp(s.hostel.trim(), 'i').test(l.hostelResidence) ||
      new RegExp(l.hostelResidence.trim(), 'i').test(s.hostel)
    );
    if (dl) {
      await Student.updateOne({ _id: s._id }, { deliveryLocation: dl._id });
      console.log(`  ✅ Student ${s._id} hostel="${s.hostel}" → linked to DeliveryLocation: ${dl.hostelResidence}`);
    } else {
      console.log(`  ⚠️  Student ${s._id} hostel="${s.hostel}" → NO matching DeliveryLocation found`);
    }
  }

  // ── Step 2: Fix unassigned delivery orders (ready/pending, no agent) ───────
  const unassigned = await Delivery.find({
    status: { $in: ['ready', 'pending'] },
    deliveryAgent: null
  }).lean();
  console.log(`\n[Step 2] Unassigned delivery orders: ${unassigned.length}`);

  for (const order of unassigned) {
    // Get student profile (freshly after step 1 updates)
    const studentProfile = await Student.findOne({ user: order.student }).lean();
    const locId = order.deliveryLocation || studentProfile?.deliveryLocation || null;
    const hostelText = studentProfile?.hostel || order.location || '';

    let resolvedLocId = locId;
    if (!resolvedLocId && hostelText && hostelText !== 'Campus') {
      const dl = allLocs.find(l =>
        new RegExp(hostelText.trim(), 'i').test(l.hostelResidence) ||
        new RegExp(l.hostelResidence.trim(), 'i').test(hostelText)
      );
      if (dl) resolvedLocId = dl._id;
    }

    if (!resolvedLocId) {
      console.log(`  ⚠️  Order ${order._id}: Cannot resolve location (student hostel="${hostelText}")`);
      continue;
    }

    const driver = allApprovedStaff.find(s =>
      (s.assignedLocations || []).some(l => l.toString() === resolvedLocId.toString())
    );

    if (!driver) {
      const locName = allLocs.find(l => l._id.toString() === resolvedLocId.toString())?.hostelResidence || resolvedLocId;
      console.log(`  ⚠️  Order ${order._id}: No approved driver for location "${locName}"`);
      continue;
    }

    // Build full location string with block/floor/room
    const locationParts = [
      studentProfile?.hostel || hostelText,
      studentProfile?.block ? `Block ${studentProfile.block}` : null,
      studentProfile?.floor ? `Floor ${studentProfile.floor}` : null,
      studentProfile?.room ? `Room ${studentProfile.room}` : null,
      studentProfile?.landmark ? `(${studentProfile.landmark})` : null,
    ].filter(Boolean);
    const fullLocation = locationParts.join(', ');

    // Update the order directly (bypass pre-save hook since it only runs on pending)
    await Delivery.updateOne(
      { _id: order._id },
      {
        deliveryAgent: driver.user,
        deliveryLocation: resolvedLocId,
        location: fullLocation || order.location,
        status: 'assigned'
      }
    );

    const locName = allLocs.find(l => l._id.toString() === resolvedLocId.toString())?.hostelResidence;
    console.log(`  ✅ Order ${order._id}: Assigned driver ${driver.user} → ${locName} (${fullLocation}). Status → assigned`);
  }

  console.log('\n✅ Backfill complete.');
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
