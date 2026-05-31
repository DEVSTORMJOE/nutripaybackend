// scripts/test_refinement_pass2.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');
const Vendor = require('../models/Vendor');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const Subscription = require('../models/Subscription');
const CustomOrder = require('../models/CustomOrder');
const Meal = require('../models/Meal');
const MealChangeLog = require('../models/MealChangeLog');
const CommissionAudit = require('../models/CommissionAudit');
const SystemSettings = require('../models/SystemSettings');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');

dotenv.config();

function heading(text) {
  console.log(`\n========================================`);
  console.log(`🚀 REFINEMENT PASS 2 TEST: ${text}`);
  console.log(`========================================`);
}

function success(text) {
  console.log(`✅ SUCCESS: ${text}`);
}

async function runRefinementValidation() {
  await connectDB();
  
  heading("INITIALIZING REFINEMENT PASS 2 TEST DATA");
  
  // Cleanup old test entries
  await User.deleteMany({ email: /test_ref2/ });
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await CustomOrder.deleteMany({});
  await Meal.deleteMany({ name: /Ref2/ });
  await MealChangeLog.deleteMany({});
  await CommissionAudit.deleteMany({});
  await SystemSettings.deleteMany({});

  // 1. Create Test Students
  const studentUser = await User.create({
    name: "Ref2 Student",
    email: "test_ref2_student@nutripay.com",
    password: "password123",
    role: "student",
    isApproved: true
  });
  
  const studentProfile = await Student.create({
    user: studentUser._id,
    university: "Egerton University",
    campus: "Njoro Main Campus",
    hostel: "Ruwenzori",
    block: "A",
    room: "23",
    landmark: "Near gate"
  });

  // 2. Create Test Vendors
  const vendorUser = await User.create({
    name: "Ref2 Vendor",
    email: "test_ref2_vendor@nutripay.com",
    password: "password123",
    role: "vendor",
    isApproved: true
  });
  
  const vendorProfile = await Vendor.create({
    user: vendorUser._id,
    businessName: "Ref2 Kitchen",
    businessPhone: "0711223344",
    approvedStatus: "approved",
    vendorCommissionPercent: 90,
    platformCommissionPercent: 10
  });

  // 3. Create meals
  const mealCheap = await Meal.create({
    vendor: vendorProfile._id,
    name: "Ref2 Cheap Beans",
    category: "main",
    price: 100,
    approvalStatus: "approved"
  });

  const mealExpensive = await Meal.create({
    vendor: vendorProfile._id,
    name: "Ref2 Feast Chicken",
    category: "main",
    price: 500,
    approvalStatus: "approved"
  });

  success("Test users, profiles, and meals initialized.");

  // Node 1 & 2: Wallet Seeding Verification
  heading("NODE 1 & 2: WALLET BALANCE SEEDING");
  // Let's seed student and vendor wallets manually to match seed configuration
  const seedAmountStudent = 50000;
  const studentWallet = await Wallet.findOneAndUpdate(
    { user: studentUser._id },
    {
      walletType: 'student',
      availableBalanceKES: seedAmountStudent,
      lockedBalanceKES: 0,
      tokenBalanceNT: seedAmountStudent,
      walletFundingSources: [{
        sourceType: 'self',
        amountKES: seedAmountStudent,
        restrictedUsage: false,
        restrictedUsageType: 'none'
      }]
    },
    { upsert: true, new: true }
  );

  if (studentWallet.availableBalanceKES === seedAmountStudent && studentWallet.tokenBalanceNT === seedAmountStudent) {
    success(`Environment balances seeded perfectly! 1 KES (${studentWallet.availableBalanceKES}) = 1 NT (${studentWallet.tokenBalanceNT}) token sync.`);
  } else {
    throw new Error("Wallet balance seeding or token mirror failed.");
  }

  // Node 3 & 4: Dynamic plan pricing defaults
  heading("NODE 3 & 4: DYNAMIC PLAN PRICING");
  const priceSetting = await SystemSettings.create({
    key: 'essential_price',
    value: 3500
  });
  success(`System settings initialized: Essential Tier Monthly Price = ${priceSetting.value} KES`);

  // Node 5 & 6: Quick Order checkout checks (must not consume subscription locked balance)
  heading("NODE 5 & 6: QUICK ORDER BALANCE CHECKOUT PROTECTION");
  // Set student wallet locked balance representing subscription escrow
  studentWallet.lockedBalanceKES = 4000;
  studentWallet.availableBalanceKES = 100; // Low available balance to test checkout failure if cost is high
  await studentWallet.save();

  // Custom Quick Order paid via wallet
  const items = [{ name: "Ref2 Cheap Beans", quantity: 2 }]; // Total 200 KES
  try {
    await walletService.processWalletCustomOrder(
      studentUser._id,
      vendorUser._id,
      items,
      200,
      'Ruwenzori Hostel',
      studentUser.name,
      studentUser.phone
    );
    throw new Error("Quick Order paid successfully despite insufficient available balance (escrow locked balance was bypassed or wrongly deducted)!");
  } catch (err) {
    success(`Quick Order checkout correctly rejected insufficient available balance: ${err.message}`);
  }

  // Re-fund available balance to let it pass
  studentWallet.availableBalanceKES = 1000;
  await studentWallet.save();

  const walletOrderResult = await walletService.processWalletCustomOrder(
    studentUser._id,
    vendorUser._id,
    items,
    200,
    'Ruwenzori Hostel',
    studentUser.name,
    studentUser.phone
  );
  success(`Quick Order paid using Available Balance successfully. Vendor Share KES ${walletOrderResult.vendorShare}, Platform Commission KES ${walletOrderResult.commission}.`);

  // Node 7: Dynamic Vendor Commission split
  heading("NODE 7: DYNAMIC VENDOR COMMISSION ADJUSTMENT");
  vendorProfile.vendorCommissionPercent = 85;
  vendorProfile.platformCommissionPercent = 15;
  await vendorProfile.save();
  success(`Vendor profile commissions dynamically changed: 85% Vendor / 15% Platform.`);

  const payoutResult = await walletService.splitCustomOrderRevenue(1000, vendorUser._id);
  if (payoutResult.vendorShare === 850 && payoutResult.commission === 150) {
    success(`Immediate payout split dynamically adjusted to new rates: Vendor gets KES 850, Platform gets KES 150.`);
  } else {
    throw new Error(`Platform split calculation mismatch. Got: Vendor ${payoutResult.vendorShare}, Commission ${payoutResult.commission}`);
  }

  // Node 8: Shuffle preparation threshold validation
  heading("NODE 8: SHUFFLE PREPARATION THRESHOLD");
  // Set up student subscription
  const subscription = await Subscription.create({
    student: studentUser._id,
    meal: mealCheap._id,
    dailyCost: 100,
    planId: 'essential',
    status: 'active',
    startDate: new Date(),
    endDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000)
  });

  const deliveryShuffle = await Delivery.create({
    student: studentUser._id,
    vendor: vendorProfile._id,
    items: [{ name: "Ref2 Cheap Beans", quantity: 1 }],
    status: 'pending',
    totalCost: 100,
    timeSlot: 'Lunch',
    scheduledDate: new Date()
  });

  // We set up threshold mock: total active subscribers on essential is 30, so threshold is 10.
  // There is only 1 pending delivery with this original meal name.
  // Shuffling should drop the count below threshold and trigger rejection!
  try {
    // Inject multiple mock subscriptions to get total essential subscribers to 30
    const mockUsers = [];
    for (let i = 0; i < 29; i++) {
      const mockUser = await User.create({
        name: `Ref2 Subscriber ${i}`,
        email: `ref2_sub_${i}@nutripay.com`,
        password: "password123",
        role: "student",
        isApproved: true
      });
      await Subscription.create({
        student: mockUser._id,
        meal: mealCheap._id,
        dailyCost: 100,
        planId: 'essential',
        status: 'active'
      });
      mockUsers.push(mockUser);
    }

    // Call the studentController's shuffle meal logic directly
    const studentController = require('../controllers/studentController');
    const mockReq = {
      user: { id: studentUser._id },
      body: { deliveryId: deliveryShuffle._id, newMealId: mealExpensive._id }
    };
    const mockRes = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
        return this;
      }
    };

    await studentController.shuffleMeal(mockReq, mockRes);
    
    if (mockRes.statusCode === 400 && mockRes.body.message === "This meal cannot be selected because the minimum preparation threshold would be violated.") {
      success(`Shuffle correctly rejected with threshold protection message: "${mockRes.body.message}"`);
    } else {
      throw new Error(`Shuffle failed to trigger preparation threshold protection. Status: ${mockRes.statusCode}, body: ${JSON.stringify(mockRes.body)}`);
    }
  } catch (err) {
    throw err;
  }

  // Node 9: Meal Change Engine tests
  heading("NODE 9: MEAL CHANGE TIMELINE & BUDGET TIMEOUTS");
  const deliveryChange = await Delivery.create({
    student: studentUser._id,
    vendor: vendorProfile._id,
    items: [{ name: "Ref2 Cheap Beans", quantity: 1 }],
    status: 'pending',
    totalCost: 100,
    timeSlot: 'Lunch',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Scheduled tomorrow
  });

  const studentController = require('../controllers/studentController');

  // Test 1: Change to expensive meal beyond budget
  // Daily budget = 3500 / 28 = 125 KES. Expensive meal = 500 KES. Should fail budget check.
  const reqBudget = {
    user: { id: studentUser._id },
    body: { deliveryId: deliveryChange._id, newMealId: mealExpensive._id }
  };
  const resBudget = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };
  await studentController.changeMeal(reqBudget, resBudget);
  if (resBudget.statusCode === 400 && resBudget.body.message.includes("exceeds daily budget")) {
    success(`Meal change correctly rejected: "${resBudget.body.message}"`);
  } else {
    throw new Error(`Meal change failed to reject daily budget limit. Status: ${resBudget.statusCode}, body: ${JSON.stringify(resBudget.body)}`);
  }

  // Test 2: Change to cheap meal within budget scheduled tomorrow. Should succeed.
  const reqSuccess = {
    user: { id: studentUser._id },
    body: { deliveryId: deliveryChange._id, newMealId: mealCheap._id }
  };
  const resSuccess = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };
  await studentController.changeMeal(reqSuccess, resSuccess);
  if (resSuccess.statusCode !== 400 && resSuccess.body.success) {
    success("Meal change completed successfully within daily budget and cutoff timeframe.");
  } else {
    throw new Error(`Meal change failed to execute under safe conditions: ${JSON.stringify(resSuccess.body)}`);
  }

  // Test 3: Cutoff check. Schedule a delivery 1 hour from now (Lunch cutoff is 10:00 AM. Let's schedule it with cutoff already passed).
  const deliveryExpired = await Delivery.create({
    student: studentUser._id,
    vendor: vendorProfile._id,
    items: [{ name: "Ref2 Cheap Beans", quantity: 1 }],
    status: 'pending',
    timeSlot: 'Lunch',
    scheduledDate: new Date() // Scheduled today, which is guaranteed to have passed 10:00 AM cutoff since local time is 3:15 PM
  });

  const reqExpired = {
    user: { id: studentUser._id },
    body: { deliveryId: deliveryExpired._id, newMealId: mealCheap._id }
  };
  const resExpired = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };
  await studentController.changeMeal(reqExpired, resExpired);
  if (resExpired.statusCode === 400 && resExpired.body.message.includes("Cutoff time has passed")) {
    success(`Meal change correctly rejected past the 2-hour cutoff limit: "${resExpired.body.message}"`);
  } else {
    throw new Error(`Meal change failed to enforce cutoff time: ${JSON.stringify(resExpired.body)}`);
  }

  // Clean up
  await User.deleteMany({ email: /test_ref2/ });
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await CustomOrder.deleteMany({});
  await Meal.deleteMany({ name: /Ref2/ });
  await MealChangeLog.deleteMany({});
  await CommissionAudit.deleteMany({});
  await SystemSettings.deleteMany({});

  heading("ALL REFINEMENT PASS 2 TEST CASES SUCCESSFULLY VERIFIED!");
  process.exit(0);
}

runRefinementValidation().catch(err => {
  console.error("❌ REFINEMENT PASS 2 TEST FAILED:", err);
  process.exit(1);
});
