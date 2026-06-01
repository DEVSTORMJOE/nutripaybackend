// scripts/test_pass5_delivery_and_orders.js
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
const MealChangeLog = require('../models/MealChangeLog');
const Transaction = require('../models/Transaction');
const SystemSettings = require('../models/SystemSettings');
const DeliveryLocation = require('../models/DeliveryLocation');
const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const walletService = require('../services/walletService');
const studentController = require('../controllers/studentController');
const vendorController = require('../controllers/vendorController');
const deliveryController = require('../controllers/deliveryController');

dotenv.config();

function heading(text) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🚀 PASS 5 VERIFICATION: ${text}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

function success(text) {
  console.log(`✅ SUCCESS: ${text}`);
}

async function runPass5Validation() {
  await connectDB();
  
  heading("INITIALIZING PASS 5 TEST DATA");
  
  // Cleanup old test entries
  await User.deleteMany({ email: /test_pass5/ });
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await Meal.deleteMany({ name: /Pass5/ });
  await MealChangeLog.deleteMany({});
  await Transaction.deleteMany({});
  await SystemSettings.deleteMany({});
  await DeliveryLocation.deleteMany({});
  await DeliveryPersonnel.deleteMany({});

  // 1. Create Test DeliveryLocation (Hostel managed by Admin)
  const hostelLocation = await DeliveryLocation.create({
    hostelResidence: "Tsavo Hostel",
    description: "Tsavo Male Residence Hall",
    isActive: true
  });

  // 2. Create Test Driver
  const driverUser = await User.create({
    name: "Pass5 Driver",
    email: "test_pass5_driver@nutripay.com",
    password: "password123",
    role: "delivery",
    isApproved: true
  });

  const driverProfile = await DeliveryPersonnel.create({
    user: driverUser._id,
    transportMode: "bicycle",
    availability: "online",
    assignedLocations: [hostelLocation._id]
  });

  // 3. Create Test Student
  const studentUser = await User.create({
    name: "Pass5 Student",
    email: "test_pass5_student@nutripay.com",
    password: "password123",
    role: "student",
    isApproved: true
  });
  
  // Student manages their own block, floor, room, and landmark
  const studentProfile = await Student.create({
    user: studentUser._id,
    university: "Egerton University",
    campus: "Njoro Main Campus",
    deliveryLocation: hostelLocation._id,
    hostel: "Tsavo Hostel",
    block: "C",
    floor: "3rd Floor",
    room: "305",
    landmark: "Directly opposite the common room stairwell"
  });

  // 4. Create Test Vendor
  const vendorUser = await User.create({
    name: "Pass5 Vendor",
    email: "test_pass5_vendor@nutripay.com",
    password: "password123",
    role: "vendor",
    isApproved: true
  });
  
  const vendorProfile = await Vendor.create({
    user: vendorUser._id,
    businessName: "Pass5 Kitchen",
    businessPhone: "0711223344",
    approvedStatus: "approved",
    vendorCommissionPercent: 90,
    platformCommissionPercent: 10
  });

  // 5. Create meals
  const mealCheap = await Meal.create({
    vendor: vendorProfile._id,
    name: "Pass5 Cheap Rice",
    category: "main",
    price: 100,
    approvalStatus: "approved"
  });

  const mealExpensive = await Meal.create({
    vendor: vendorProfile._id,
    name: "Pass5 Feast Chicken",
    category: "main",
    price: 500,
    approvalStatus: "approved"
  });

  // Seed wallets
  const seedAmount = 10000;
  const adminWallet = await Wallet.findOneAndUpdate(
    { walletType: 'admin' },
    { availableBalanceKES: seedAmount, lockedBalanceKES: 0 },
    { upsert: true, new: true }
  );

  const studentWallet = await Wallet.findOneAndUpdate(
    { user: studentUser._id },
    { availableBalanceKES: seedAmount, lockedBalanceKES: seedAmount, walletType: 'student' },
    { upsert: true, new: true }
  );

  const vendorWallet = await Wallet.findOneAndUpdate(
    { user: vendorUser._id },
    { availableBalanceKES: 0, lockedBalanceKES: 0, walletType: 'vendor' },
    { upsert: true, new: true }
  );

  success("Test users, profiles, locations, meals, and wallets initialized successfully.");

  // Metric 1: Delivery Location Restructure Validation
  heading("METRIC 1: DELIVERY LOCATION STRUCTURAL TRANSITION");
  if (studentProfile.hostel === "Tsavo Hostel" && studentProfile.block === "C" && studentProfile.floor === "3rd Floor" && studentProfile.room === "305" && studentProfile.landmark.includes("common room")) {
    success("Admin manages Hostel ('Tsavo Hostel'); Student stores Block ('C'), Floor ('3rd Floor'), Room ('305'), and Landmark successfully.");
  } else {
    throw new Error("Delivery location restructuring failed.");
  }

  // Metric 2: Verification Code Generation on 'ready'
  heading("METRIC 2: UNIQUE VERIFICATION CODE GENERATION");
  const delivery = await Delivery.create({
    student: studentUser._id,
    vendor: vendorProfile._id,
    items: [{ name: "Pass5 Cheap Rice", quantity: 1 }],
    status: 'pending',
    totalCost: 150,
    timeSlot: 'Lunch',
    scheduledDate: new Date(),
    deliveryLocation: hostelLocation._id
  });

  // Update status to 'ready' using vendorController
  const mockReqReady = {
    params: { id: delivery._id },
    body: { status: 'ready' },
    user: { id: vendorUser._id }
  };
  const mockResReady = {
    json: function(data) { this.body = data; return this; }
  };

  await vendorController.updateOrderStatus(mockReqReady, mockResReady);
  const updatedDeliveryReady = await Delivery.findById(delivery._id);
  
  if (updatedDeliveryReady.deliveryVerificationCode && updatedDeliveryReady.deliveryVerificationCode.startsWith("NP-") && updatedDeliveryReady.deliveryVerificationExpiry) {
    success(`Verification code successfully generated: ${updatedDeliveryReady.deliveryVerificationCode}. Expiry is correctly configured.`);
  } else {
    throw new Error("Verification code generation failed.");
  }

  // Metric 3: Verification Code Enforcement
  heading("METRIC 3: VERIFICATION CODE ENFORCEMENT & Payout Escrow Release");
  // Try marking delivered with invalid code
  const mockReqInvalid = {
    body: { deliveryId: delivery._id, code: "NP-INVALID-CODE" },
    user: { id: driverUser._id, name: driverUser.name }
  };
  const mockResInvalid = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await deliveryController.markDelivered(mockReqInvalid, mockResInvalid);
  if (mockResInvalid.statusCode === 400 && mockResInvalid.body.message.includes("Invalid delivery verification code")) {
    success("Enforcement successfully blocked incorrect verification code.");
  } else {
    throw new Error(`Verification code enforcement failed to block invalid code. Status: ${mockResInvalid.statusCode}, Body: ${JSON.stringify(mockResInvalid.body)}`);
  }

  // Now, test case-insensitive correct verification code
  const correctCodeLower = updatedDeliveryReady.deliveryVerificationCode.toLowerCase();
  const mockReqValid = {
    body: { deliveryId: delivery._id, code: correctCodeLower },
    user: { id: driverUser._id, name: driverUser.name }
  };
  const mockResValid = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await deliveryController.markDelivered(mockReqValid, mockResValid);
  const finalDelivery = await Delivery.findById(delivery._id);
  
  if (finalDelivery.status === 'delivered') {
    success("Enforcement successfully verified correct case-insensitive verification code and marked delivery as delivered.");
  } else {
    throw new Error(`Verification code enforcement failed to accept correct code. Status: ${mockResValid.statusCode}, Body: ${JSON.stringify(mockResValid.body)}`);
  }

  // Metric 4: Meal Change Engine daily budget protection
  heading("METRIC 4: MEAL CHANGE ENGINE DAILY BUDGET PROTECTION");
  // Essential monthly price system setting
  await SystemSettings.create({ key: 'essential_price', value: 3500 });
  const sub = await Subscription.create({
    student: studentUser._id,
    meal: mealCheap._id,
    dailyCost: 100,
    planId: 'essential',
    status: 'active',
    startDate: new Date(),
    endDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000)
  });

  const deliveryChange = await Delivery.create({
    student: studentUser._id,
    vendor: vendorProfile._id,
    items: [{ name: "Pass5 Cheap Rice", quantity: 1 }],
    status: 'pending',
    totalCost: 100,
    timeSlot: 'Lunch',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Scheduled tomorrow
  });

  // Get alternatives
  const mockReqAlts = {
    query: { deliveryId: deliveryChange._id },
    user: { id: studentUser._id }
  };
  const mockResAlts = {
    json: function(data) { this.body = data; return this; }
  };

  await studentController.getMealChangeAlternatives(mockReqAlts, mockResAlts);
  const alts = mockResAlts.body.meals;
  const budget = mockResAlts.body.dailyBudget;

  const cheapAltCount = alts.filter(a => a.price <= budget).length;
  const expensiveAltCount = alts.filter(a => a.price > budget).length;

  if (budget === 125 && cheapAltCount > 0 && expensiveAltCount === 0) {
    success(`Alternatives endpoint returned only meals within daily budget of ${budget} KES. Excluded expensive options successfully.`);
  } else {
    throw new Error(`Budget constraint verification failed. Daily Budget: ${budget}, cheap alternatives: ${cheapAltCount}, expensive: ${expensiveAltCount}`);
  }

  // Metric 5: Transaction route explanations and dynamic mapping
  heading("METRIC 5: DYNAMIC TRANSACTION ROUTE TRANSPARENCY");
  const testTx = await Transaction.create({
    transactionId: "TX-PASS5-123",
    fromUser: studentUser._id,
    toUser: vendorUser._id,
    amountKES: 150,
    transactionCategory: 'custom_order',
    paymentMethod: 'wallet',
    status: 'completed'
  });

  const mockReqTx = {
    user: { id: studentUser._id }
  };
  const mockResTx = {
    json: function(data) { this.body = data; return this; }
  };

  const walletController = require('../controllers/walletController');
  await walletController.getTransactions(mockReqTx, mockResTx);
  
  const explainedTx = mockResTx.body.find(t => t.transactionId === "TX-PASS5-123");
  if (explainedTx && explainedTx.source.includes("Pass5 Student") && explainedTx.destination.includes("Pass5 Vendor") && explainedTx.purpose.includes("Quick")) {
    success(`Route resolved dynamically: Source = "${explainedTx.source}", Destination = "${explainedTx.destination}", Purpose = "${explainedTx.purpose}"`);
  } else {
    throw new Error("Transaction dynamic route explanation failed.");
  }

  // Metric 6: Donation Persistence and Claim Lifecycle
  heading("METRIC 6: DONATION PERSISTENCE AND STATE INTEGRITY");
  const deliveryDonate = await Delivery.create({
    student: studentUser._id,
    vendor: vendorProfile._id,
    items: [{ name: "Pass5 Cheap Rice", quantity: 1 }],
    status: 'pending',
    totalCost: 100,
    timeSlot: 'Lunch',
    scheduledDate: new Date()
  });

  const mockReqDonate = {
    body: { deliveryId: deliveryDonate._id },
    user: { id: studentUser._id }
  };
  const mockResDonate = {
    json: function(data) { this.body = data; return this; }
  };

  await studentController.donateDelivery(mockReqDonate, mockResDonate);
  const donatedDelivery = await Delivery.findById(deliveryDonate._id);
  
  if (donatedDelivery.status === 'donated' && donatedDelivery.isDonated === true && donatedDelivery.originalStudent.toString() === studentUser._id.toString()) {
    success("Donation persistence validated. State remains strictly 'donated' and links to original student properly.");
  } else {
    throw new Error("Donation persistence check failed.");
  }

  // Clean up
  await User.deleteMany({ email: /test_pass5/ });
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await Meal.deleteMany({ name: /Pass5/ });
  await MealChangeLog.deleteMany({});
  await Transaction.deleteMany({});
  await SystemSettings.deleteMany({});
  await DeliveryLocation.deleteMany({});
  await DeliveryPersonnel.deleteMany({});

  heading("ALL PASS 5 AUTOMATED VERIFICATION METRICS PASSED SUCCESSFULLY!");
  process.exit(0);
}

runPass5Validation().catch(err => {
  console.error("❌ PASS 5 VERIFICATION FAILED:", err);
  process.exit(1);
});
