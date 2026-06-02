const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');
const Vendor = require('../models/Vendor');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const Subscription = require('../models/Subscription');
const Meal = require('../models/Meal');
const DeliveryLocation = require('../models/DeliveryLocation');
const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const cartController = require('../controllers/cartController');

dotenv.config();

function heading(text) {
  console.log(`\n========================================`);
  console.log(`🚀 REFINEMENT PASS 4 E2E TEST: ${text}`);
  console.log(`========================================`);
}

function success(text) {
  console.log(`✅ SUCCESS: ${text}`);
}

async function runTest() {
  await connectDB();

  heading("CLEANING OLD TEST ENTRIES");
  await User.deleteMany({ email: /test_ref4/ });
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await Meal.deleteMany({ name: /Ref4/ });
  await DeliveryLocation.deleteMany({});
  await DeliveryPersonnel.deleteMany({});

  heading("SEEDING TEST DATA");
  const testLocation = await DeliveryLocation.create({
    hostelResidence: "Kilimanjaro Hall",
    university: "Egerton University",
    campus: "Njoro Main Campus",
    isActive: true
  });

  const studentUser = await User.create({
    name: "Ref4 Student",
    email: "test_ref4_student@nutripay.com",
    password: "password123",
    role: "student",
    isApproved: true
  });

  const studentProfile = await Student.create({
    user: studentUser._id,
    university: "Egerton University",
    campus: "Njoro Main Campus",
    deliveryLocation: testLocation._id,
    hostelResidence: "Kilimanjaro Hall"
  });

  const driverUser = await User.create({
    name: "Ref4 Driver",
    email: "test_ref4_driver@nutripay.com",
    password: "password123",
    role: "delivery",
    isApproved: true
  });

  const driverProfile = await DeliveryPersonnel.create({
    user: driverUser._id,
    availability: "online",
    assignedLocations: [testLocation._id],
    approvedStatus: "approved"
  });

  const vendorUser = await User.create({
    name: "Ref4 Vendor",
    email: "test_ref4_vendor@nutripay.com",
    password: "password123",
    role: "vendor",
    isApproved: true
  });

  const vendorProfile = await Vendor.create({
    user: vendorUser._id,
    businessName: "Ref4 Kitchen",
    approvedStatus: "approved"
  });

  const testMeal = await Meal.create({
    vendor: vendorProfile._id,
    name: "Ref4 Rice",
    category: "main",
    price: 150,
    approvalStatus: "approved"
  });

  await Wallet.findOneAndUpdate(
    { user: studentUser._id },
    { 
      walletType: 'student',
      availableBalanceKES: 10000, 
      lockedBalanceKES: 0,
      tokenBalanceNT: 10000,
      walletFundingSources: [{
        sourceType: 'self',
        amountKES: 10000,
        restrictedUsage: false,
        restrictedUsageType: 'none'
      }]
    },
    { upsert: true, new: true }
  );

  await Wallet.findOneAndUpdate(
    { user: vendorUser._id },
    { availableBalanceKES: 0, lockedBalanceKES: 0, walletType: 'vendor' },
    { upsert: true, new: true }
  );

  success("Successfully seeded test data.");

  heading("TEST 1: CUSTOM MONTHLY PLAN WITH SKIP FOR EMPTY SLOTS");
  // Simulating a 3-day plan (day 0, day 1, day 2 has Lunch, all other slots/days are empty)
  const customSchedule = Array.from({ length: 28 }, (_, idx) => {
    if (idx < 3) {
      return { breakfast: null, lunch: testMeal._id, supper: null };
    }
    return { breakfast: null, lunch: null, supper: null };
  });

  const mockReqCustom = {
    user: { id: studentUser._id },
    body: {
      startDate: new Date().toISOString().split("T")[0],
      daysCount: 28,
      breakfast: false,
      lunch: true,
      supper: false,
      customSchedule,
      totalCost: 450
    }
  };

  const mockResCustom = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await cartController.customPlanCheckout(mockReqCustom, mockResCustom);
  
  if (mockResCustom.statusCode === 200 || mockResCustom.statusCode === 201) {
    const deliveries = await Delivery.find({ student: studentUser._id });
    if (deliveries.length === 3) {
      success(`Verified: Custom Plan only created ${deliveries.length} deliveries for non-empty schedule slots! Skipping empty slots is functioning correctly.`);
    } else {
      throw new Error(`Expected exactly 3 deliveries, but got: ${deliveries.length}`);
    }
  } else {
    throw new Error(`Custom plan checkout failed: ${JSON.stringify(mockResCustom.body)}`);
  }

  heading("TEST 2: DIRECT DAILY TEMPLATE RANGE CHECKOUT");
  // Clean deliveries
  await Delivery.deleteMany({});

  const mockReqDaily = {
    user: { id: studentUser._id },
    body: {
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 3 days range
      items: [{ mealId: testMeal._id, name: testMeal.name, price: testMeal.price, qty: 1 }],
      timeSlot: "Lunch",
      totalCost: 450
    }
  };

  const mockResDaily = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await cartController.dailyTemplateCheckout(mockReqDaily, mockResDaily);

  if (mockResDaily.statusCode === 200 || mockResDaily.statusCode === 201) {
    const deliveries = await Delivery.find({ student: studentUser._id });
    if (deliveries.length === 3) {
      success(`Verified: Direct Daily Template checkout created exactly ${deliveries.length} deliveries!`);
      const dlResolved = deliveries.every(d => String(d.deliveryLocation) === String(testLocation._id));
      if (dlResolved) {
        success("Verified: Student delivery location resolved correctly at checkout (not hardcoded to null/Campus)!");
      } else {
        throw new Error("Student delivery location failed to resolve properly.");
      }
    } else {
      throw new Error(`Expected exactly 3 deliveries, but got: ${deliveries.length}`);
    }
  } else {
    throw new Error(`Daily template checkout failed: ${JSON.stringify(mockResDaily.body)}`);
  }

  heading("TEST 3: AUTO-ROUTING DRIVER ONLY WHEN MARKED 'READY'");
  const testDelivery = await Delivery.findOne({ student: studentUser._id, status: "pending" });
  if (!testDelivery) throw new Error("No pending delivery found to test auto-routing.");

  if (testDelivery.status === "pending" && !testDelivery.deliveryAgent) {
    success("Verified: Delivery is NOT auto-assigned on order creation (still 'pending').");
  } else {
    throw new Error(`Unexpected delivery state at order creation: status=${testDelivery.status}, driver=${testDelivery.deliveryAgent}`);
  }

  // Update status to 'ready' using vendorController
  const vendorController = require('../controllers/vendorController');
  const mockReqReady = {
    params: { id: testDelivery._id },
    body: { status: 'ready' },
    user: { id: vendorUser._id }
  };
  const mockResReady = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await vendorController.updateOrderStatus(mockReqReady, mockResReady);
  const finalDelivery = await Delivery.findById(testDelivery._id);

  if (finalDelivery.status === "assigned" && String(finalDelivery.deliveryAgent) === String(driverUser._id)) {
    success("Verified: Order auto-assigned to the correct driver matching the location ONLY when marked 'ready' by the vendor!");
  } else {
    throw new Error(`Auto-routing failed! Status: ${finalDelivery.status}, Agent: ${finalDelivery.deliveryAgent}`);
  }

  heading("CLEANING TEST ENTRIES");
  await User.deleteMany({ email: /test_ref4/ });
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await Meal.deleteMany({ name: /Ref4/ });
  await DeliveryLocation.deleteMany({});
  await DeliveryPersonnel.deleteMany({});

  console.log(`\n🎉 ALL REFINEMENT PASS 4 E2E TESTS COMPLETED SUCCESSFULLY! 🎉`);
  process.exit(0);
}

runTest().catch(err => {
  console.error("❌ E2E TEST RUN FAILED:", err);
  process.exit(1);
});
