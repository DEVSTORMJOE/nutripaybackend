const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');
const Sponsor = require('../models/Sponsor');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const Subscription = require('../models/Subscription');
const Meal = require('../models/Meal');
const DeliveryLocation = require('../models/DeliveryLocation');
const SponsorRequest = require('../models/SponsorRequest');
const cartController = require('../controllers/cartController');
const sponsorController = require('../controllers/sponsorController');
const authController = require('../controllers/authController');

dotenv.config();

function heading(text) {
  console.log(`\n========================================`);
  console.log(`🚀 SPONSOR WORKFLOW TEST: ${text}`);
  console.log(`========================================`);
}

function success(text) {
  console.log(`✅ SUCCESS: ${text}`);
}

async function runTest() {
  await connectDB();

  heading("CLEANING OLD TEST ENTRIES");
  await User.deleteMany({ email: /test_sp/ });
  await SponsorRequest.deleteMany({});
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await Meal.deleteMany({ name: /SpMeal/ });
  await DeliveryLocation.deleteMany({});
  await Sponsor.deleteMany({});

  heading("TEST 1: SPONSOR OTP SIGNUP PASSWORD VALIDATION");
  const mockReqOtp = {
    body: { email: "test_sp_sponsor@nutripay.com" }
  };
  const mockResOtp = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await authController.sendSponsorOTP(mockReqOtp, mockResOtp);
  if (mockResOtp.statusCode === 200) {
    const createdUser = await User.findOne({ email: "test_sp_sponsor@nutripay.com" }).select("+password");
    if (createdUser && createdUser.password) {
      success("Verified: Sponsor user automatically created during OTP request has a valid password hash.");
    } else {
      throw new Error("Sponsor user was not created or lacks a password.");
    }
  } else {
    throw new Error(`OTP send failed: ${JSON.stringify(mockResOtp.body)}`);
  }

  heading("SEEDING ADDITIONAL TEST DATA");
  const studentUser = await User.create({
    name: "Sp Student",
    email: "test_sp_student@nutripay.com",
    password: "password123",
    role: "student",
    isApproved: true
  });

  const studentProfile = await Student.create({
    user: studentUser._id,
    university: "Egerton University",
    campus: "Njoro Main Campus",
    deliveryLocation: null,
    hostelResidence: "Tsavo Hall"
  });

  const vendorUser = await User.create({
    name: "Sp Vendor",
    email: "test_sp_vendor@nutripay.com",
    password: "password123",
    role: "vendor",
    isApproved: true
  });

  const Vendor = require('../models/Vendor');
  const vendorProfile = await Vendor.create({
    user: vendorUser._id,
    businessName: "Sp Kitchen",
    approvedStatus: "approved"
  });

  const meal = await Meal.create({
    vendor: vendorProfile._id,
    name: "SpMeal Rice",
    category: "main",
    price: 150,
    approvalStatus: "approved"
  });

  // Mock wallets
  await Wallet.findOneAndUpdate(
    { user: studentUser._id },
    { availableBalanceKES: 10000, lockedBalanceKES: 0, walletType: 'student' },
    { upsert: true, new: true }
  );

  await Wallet.findOneAndUpdate(
    { user: vendorUser._id },
    { availableBalanceKES: 0, lockedBalanceKES: 0, walletType: 'vendor' },
    { upsert: true, new: true }
  );

  // Mock student cart
  const Cart = require('../models/Cart');
  await Cart.create({
    user: studentUser._id,
    templates: [{
      id: "tmpl_essential",
      planId: "essential",
      isMonthlyPlan: true,
      billingCycle: "monthly",
      main: { mealId: meal._id, name: meal.name, price: meal.price, category: "main" }
    }]
  });

  success("Successfully seeded test student, vendor, meal, wallets and cart.");

  heading("TEST 2: SPONSOR CHECKOUT CREATING SPONSORREQUEST WITH PLAN DETAILS");
  const mockReqCheckout = {
    user: { id: studentUser._id },
    body: {
      sponsorName: "Sponsor test_sp",
      sponsorEmail: "test_sp_sponsor2@nutripay.com",
      sponsorPhone: "254711111111"
    }
  };
  const mockResCheckout = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await cartController.addSponsorCheckout(mockReqCheckout, mockResCheckout);
  if (mockResCheckout.statusCode === 200) {
    const spReq = await SponsorRequest.findOne({ sponsorEmail: "test_sp_sponsor2@nutripay.com" });
    if (spReq && spReq.planId === "essential" && spReq.startDate && spReq.endDate) {
      success("Verified: SponsorRequest successfully generated containing planId=essential, startDate, and endDate.");
    } else {
      throw new Error(`SponsorRequest details mismatch: ${JSON.stringify(spReq)}`);
    }
  } else {
    throw new Error(`Sponsor checkout request failed: ${JSON.stringify(mockResCheckout.body)}`);
  }

  heading("TEST 3: SPONSOR WALLET QUICK-PAY & SUBSCRIPTION ACTIVATION");
  const activeReq = await SponsorRequest.findOne({ sponsorEmail: "test_sp_sponsor2@nutripay.com" });
  const mockReqQuick = {
    body: { token: activeReq.token }
  };
  const mockResQuick = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await sponsorController.quickPay(mockReqQuick, mockResQuick);
  if (mockResQuick.statusCode === 200 || mockResQuick.body?.success) {
    const updatedProfile = await Student.findOne({ user: studentUser._id });
    const subRecord = await Subscription.findOne({ student: studentUser._id });
    const paidRequest = await SponsorRequest.findById(activeReq._id);
    
    if (updatedProfile.subscriptionActive && subRecord && subRecord.status === 'active' && paidRequest.status === 'paid') {
      success("Verified: Wallet quick-pay marked SponsorRequest as paid, activated student's subscription, and created Subscription record.");
    } else {
      throw new Error(`State verification failed: subActive=${updatedProfile.subscriptionActive}, subRecord=${JSON.stringify(subRecord)}, requestStatus=${paidRequest?.status}`);
    }
  } else {
    throw new Error(`Quick pay failed: ${JSON.stringify(mockResQuick.body)}`);
  }

  heading("TEST 4: SPONSOR M-PESA QUICK-PAY AND POLLING VERIFICATION");
  // Reset student subscription state for M-Pesa test
  await Student.findOneAndUpdate({ user: studentUser._id }, { subscriptionActive: false });
  await Subscription.deleteMany({});
  
  // Set student cart back
  const CartModel = require('../models/Cart');
  await CartModel.findOneAndUpdate({ user: studentUser._id }, {
    templates: [{
      id: "tmpl_essential",
      planId: "essential",
      isMonthlyPlan: true,
      billingCycle: "monthly",
      main: { mealId: meal._id, name: meal.name, price: meal.price, category: "main" }
    }]
  });

  // Create another sponsor request
  const mockResCheckout2 = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };
  await cartController.addSponsorCheckout(mockReqCheckout, mockResCheckout2);
  const activeReq2 = await SponsorRequest.findOne({ sponsorEmail: "test_sp_sponsor2@nutripay.com", status: "pending" });

  const mockReqMpesa = {
    body: { token: activeReq2.token, phone: "254711111111" }
  };
  const mockResMpesa = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await sponsorController.quickPayMpesa(mockReqMpesa, mockResMpesa);
  const checkoutRequestID = mockResMpesa.body?.checkoutRequestID;
  if (checkoutRequestID && (checkoutRequestID.startsWith("ws_CO_Mock_") || checkoutRequestID.startsWith("ws_CO_"))) {
    success(`Verified: M-Pesa Quick Pay triggered mock STK push. checkoutRequestID: ${checkoutRequestID}`);
    
    // Now trigger status check (polling) which auto-completes mock payments
    const mockReqPoll = {
      params: { checkoutRequestID }
    };
    const mockResPoll = {
      statusCode: 200,
      status: function(code) { this.statusCode = code; return this; },
      json: function(data) { this.body = data; return this; }
    };

    await sponsorController.checkSponsorMpesaStatus(mockReqPoll, mockResPoll);
    
    const finalProfile = await Student.findOne({ user: studentUser._id });
    const finalSub = await Subscription.findOne({ student: studentUser._id });
    const finalRequest = await SponsorRequest.findById(activeReq2._id);

    if (finalProfile.subscriptionActive && finalSub && finalSub.status === 'active' && finalRequest.status === 'paid') {
      success("Verified: Polling mock M-Pesa status successfully completed sponsorship checkout, activated subscription, and created Subscription record.");
    } else {
      throw new Error("M-Pesa status polling failed to activate subscription.");
    }
  } else {
    throw new Error(`M-Pesa payment trigger failed: ${JSON.stringify(mockResMpesa.body)}`);
  }

  heading("TEST 5: DASHBOARD SPONSOR FUNDING (fundRequest)");
  // Reset student state
  await Student.findOneAndUpdate({ user: studentUser._id }, { subscriptionActive: false });
  await Subscription.deleteMany({});
  
  // Set student cart back and check out as sponsor request
  await CartModel.findOneAndUpdate({ user: studentUser._id }, {
    templates: [{
      id: "tmpl_essential",
      planId: "essential",
      isMonthlyPlan: true,
      billingCycle: "monthly",
      main: { mealId: meal._id, name: meal.name, price: meal.price, category: "main" }
    }]
  });

  const mockResCheckout3 = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };
  await cartController.addSponsorCheckout(mockReqCheckout, mockResCheckout3);
  const activeReq3 = await SponsorRequest.findOne({ sponsorEmail: "test_sp_sponsor2@nutripay.com", status: "pending" });
  
  // Resolve sponsor user
  const sponsorUser = await User.findOne({ email: "test_sp_sponsor2@nutripay.com" });
  
  const mockReqFund = {
    user: { id: sponsorUser._id },
    body: {
      studentId: studentUser._id,
      deliveryIds: activeReq3.deliveryIds
    }
  };
  const mockResFund = {
    statusCode: 200,
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };

  await sponsorController.fundRequest(mockReqFund, mockResFund);
  if (mockResFund.statusCode === 200) {
    const finalProfile = await Student.findOne({ user: studentUser._id });
    const finalSub = await Subscription.findOne({ student: studentUser._id });
    const finalRequest = await SponsorRequest.findById(activeReq3._id);

    if (finalProfile.subscriptionActive && finalSub && finalSub.status === 'active' && finalRequest.status === 'paid') {
      success("Verified: Dashboard funding (fundRequest) successfully activated subscription, created Subscription record, and marked SponsorRequest as paid.");
    } else {
      throw new Error("Dashboard funding failed to update status/activate subscription.");
    }
  } else {
    throw new Error(`Dashboard funding failed: ${JSON.stringify(mockResFund.body)}`);
  }

  heading("CLEANING TEST ENTRIES");
  await User.deleteMany({ email: /test_sp/ });
  await SponsorRequest.deleteMany({});
  await Subscription.deleteMany({});
  await Delivery.deleteMany({});
  await Meal.deleteMany({ name: /SpMeal/ });
  await DeliveryLocation.deleteMany({});
  await Sponsor.deleteMany({});

  console.log(`\n🎉 ALL SPONSOR WORKFLOW E2E TESTS PASSED SUCCESSFULLY! 🎉`);
  process.exit(0);
}

runTest().catch(err => {
  console.error("❌ E2E TEST RUN FAILED:", err);
  process.exit(1);
});
