// scripts/test_refinement_pass3.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');
const Vendor = require('../models/Vendor');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const Subscription = require('../models/Subscription');
const SystemSettings = require('../models/SystemSettings');
const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const DeliveryLocation = require('../models/DeliveryLocation');

dotenv.config();

function heading(text) {
  console.log(`\n========================================`);
  console.log(`🚀 REFINEMENT PASS 3 TEST: ${text}`);
  console.log(`========================================`);
}

function success(text) {
  console.log(`✅ SUCCESS: ${text}`);
}

async function runRefinementValidation() {
  await connectDB();
  
  heading("INITIALIZING REFINEMENT PASS 3 TEST DATA");
  
  // Cleanup old test entries
  const oldUsers = await User.find({ email: /test_ref3/ });
  const oldUserIds = oldUsers.map(u => u._id);
  await Subscription.deleteMany({ student: { $in: oldUserIds } });
  await User.deleteMany({ email: /test_ref3/ });
  await Delivery.deleteMany({});
  await DeliveryPersonnel.deleteMany({});
  await DeliveryLocation.deleteMany({});
  await SystemSettings.deleteMany({});

  // 1. Create Test Student User and Profile
  const studentUser = await User.create({
    name: "Ref3 Student",
    email: "test_ref3_student@nutripay.com",
    password: "password123",
    role: "student",
    isApproved: true
  });

  const testLocation = await DeliveryLocation.create({
    university: "Egerton University",
    campus: "Njoro Main Campus",
    hostelResidence: "Ruwenzori Hall",
    block: "A",
    room: "23",
    landmark: "Near Main Gate",
    isActive: true
  });
  
  const studentProfile = await Student.create({
    user: studentUser._id,
    university: "Egerton University",
    campus: "Njoro Main Campus",
    deliveryLocation: testLocation._id,
    hostelResidence: "Ruwenzori Hall"
  });

  // 2. Create Test Driver User and DeliveryPersonnel Profile
  const driverUser = await User.create({
    name: "Ref3 Driver",
    email: "test_ref3_driver@nutripay.com",
    password: "password123",
    role: "delivery",
    isApproved: true
  });

  const driverProfile = await DeliveryPersonnel.create({
    user: driverUser._id,
    assignedLocations: [testLocation._id],
    approvedStatus: "approved",
    transportMode: "Bicycle",
    availability: "Available"
  });

  // 3. Create Test Vendor User and Vendor Profile
  const vendorUser = await User.create({
    name: "Ref3 Vendor",
    email: "test_ref3_vendor@nutripay.com",
    password: "password123",
    role: "vendor",
    isApproved: true
  });
  
  const vendorProfile = await Vendor.create({
    user: vendorUser._id,
    businessName: "Ref3 Kitchen",
    businessPhone: "0712345678",
    approvedStatus: "approved"
  });

  success("Test users, profiles, locations, and drivers successfully seeded.");

  // Test 1: Subscription Schema validation checks
  heading("TEST 1: MONTHLY PLAN SUBSCRIPTION CREATION WITHOUT MEAL AND DAILYCOST");
  try {
    const sub = await Subscription.create({
      student: studentUser._id,
      planId: "essential",
      totalPaidKES: 3500,
      status: "active"
    });
    success(`Monthly plan subscription successfully created with totalPaidKES = ${sub.totalPaidKES} and blank meal/dailyCost.`);
  } catch (err) {
    console.error("Test 1 Failed:", err);
    process.exit(1);
  }

  // Test 2: Delivery pre-save auto-routing hook validation
  heading("TEST 2: AUTOMATIC DELIVERY HUB ROUTING & DRIVER AUTO-ASSIGNMENT");
  try {
    const delivery = await Delivery.create({
      student: studentUser._id,
      vendor: vendorProfile._id,
      items: [{ name: "Mandazi", quantity: 2 }],
      totalCost: 40,
      timeSlot: "Breakfast",
      scheduledDate: new Date(),
      location: "Ruwenzori Hall"
    });

    if (delivery.status === 'assigned' && String(delivery.deliveryAgent) === String(driverUser._id)) {
      success("Pre-save auto-routing ran successfully! Delivery assigned to the driver matching the student's hostelResidence.");
    } else {
      console.error(`Pre-save auto-routing failed! Status: ${delivery.status}, deliveryAgent: ${delivery.deliveryAgent}`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Test 2 Failed with Exception:", err);
    process.exit(1);
  }

  // Test 3: System Settings fetching validation
  heading("TEST 3: SYSTEM SETTINGS PRICE DEFAULTS VERIFICATION");
  try {
    const { getSettings } = require('../controllers/adminController');
    const mockReq = {};
    const mockRes = {
      statusCode: 200,
      body: {},
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
        return this;
      }
    };

    await getSettings(mockReq, mockRes);
    if (mockRes.body && mockRes.body.essential_price === 3500) {
      success(`System settings successfully loaded default prices: Essential: ${mockRes.body.essential_price}, Elite: ${mockRes.body.elite_price}, Ultimate: ${mockRes.body.ultimate_price}`);
    } else {
      console.error("Test 3 Failed. Unexpected settings body:", mockRes.body);
      process.exit(1);
    }
  } catch (err) {
    console.error("Test 3 Failed with Exception:", err);
    process.exit(1);
  }

  console.log(`\n🎉 ALL REFINEMENT PASS 3 END-TO-END TESTS COMPLETED SUCCESSFULLY! 🎉`);
  process.exit(0);
}

runRefinementValidation().catch(e => {
  console.error("Refinement Validation error:", e);
  process.exit(1);
});
