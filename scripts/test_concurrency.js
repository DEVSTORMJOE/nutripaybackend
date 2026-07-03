const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Student = require('../models/Student');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const RefundRequest = require('../models/RefundRequest');
const Cart = require('../models/Cart');

const adminController = require('../controllers/adminController');
const cartController = require('../controllers/cartController');

function makeMockRes() {
  const res = {
    statusVal: 200,
    jsonVal: null,
    status(code) {
      this.statusVal = code;
      return this;
    },
    json(obj) {
      this.jsonVal = obj;
      return this;
    }
  };
  return res;
}

async function runConcurrencyTests() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log("Connected to MongoDB for Concurrency Security Tests.");

    // Set up dummy admin and student
    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      adminUser = await User.create({
        name: 'Audit Admin',
        email: 'audit_admin@nutripay.local',
        password: 'Password123',
        role: 'admin'
      });
    }

    let studentUser = await User.findOne({ role: 'student' });
    if (!studentUser) {
      studentUser = await User.create({
        name: 'Test Concurrency Student',
        email: 'student_concur@nutripay.local',
        password: 'Password123',
        role: 'student',
        phone: '254711111111'
      });
    }

    let studentProfile = await Student.findOne({ user: studentUser._id });
    if (!studentProfile) {
      studentProfile = await Student.create({
        user: studentUser._id,
        subscriptionActive: false
      });
    }

    let studentWallet = await Wallet.findOne({ user: studentUser._id });
    if (!studentWallet) {
      studentWallet = await Wallet.create({
        user: studentUser._id,
        walletType: 'student',
        availableBalanceKES: mongoose.Types.Decimal128.fromString("1000.00"),
        lockedBalanceKES: mongoose.Types.Decimal128.fromString("0.00")
      });
    } else {
      studentWallet.availableBalanceKES = mongoose.Types.Decimal128.fromString("1000.00");
      studentWallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString("0.00");
      await studentWallet.save();
    }

    console.log("\n=======================================================");
    console.log("🛡️  RUNNING PENETRATION TEST: CONCURRENCY SECURITY");
    console.log("=======================================================");

    // ----------------------------------------------------
    // TEST 1: Double Withdrawal Approval Concurrency
    // ----------------------------------------------------
    console.log("\n[Test 1] Simulating 10 simultaneous withdrawal approval calls...");
    
    // Create a pending withdrawal request
    const withdrawal = await WithdrawalRequest.create({
      user: studentUser._id,
      amountKES: mongoose.Types.Decimal128.fromString("100.00"),
      phone: studentUser.phone,
      status: 'requested'
    });

    const withdrawalCalls = Array.from({ length: 10 }, async () => {
      const req = {
        params: { id: withdrawal._id },
        body: { status: 'approved' },
        user: adminUser,
        ip: '127.0.0.1',
        connection: {}
      };
      const res = makeMockRes();
      try {
        await adminController.handleWithdrawalRequest(req, res);
        return { success: res.statusVal === 200 || !res.jsonVal?.message?.includes("already processed"), status: res.statusVal, response: res.jsonVal };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    const withdrawalResults = await Promise.all(withdrawalCalls);
    const successfulWithdrawals = withdrawalResults.filter(r => r.success && r.status !== 400).length;
    const blockedWithdrawals = withdrawalResults.filter(r => r.status === 400).length;

    console.log(`  - Payout Requests Sent: 10`);
    console.log(`  - Successful Payouts:   ${successfulWithdrawals} (Expected: 1)`);
    console.log(`  - Blocked Duplicates:   ${blockedWithdrawals} (Expected: 9)`);

    if (successfulWithdrawals !== 1 || blockedWithdrawals !== 9) {
      console.error("  ❌ TEST 1 FAILED: Double withdrawal vulnerability detected!");
    } else {
      console.log("  ✅ TEST 1 PASSED: Concurrency check locked duplicate payouts.");
    }

    // Clean up test withdrawal
    await WithdrawalRequest.deleteOne({ _id: withdrawal._id });


    // ----------------------------------------------------
    // TEST 2: Double Refund Request Concurrency
    // ----------------------------------------------------
    console.log("\n[Test 2] Simulating 10 simultaneous refund approval calls...");

    const refund = await RefundRequest.create({
      student: studentUser._id,
      amountKES: mongoose.Types.Decimal128.fromString("200.00"),
      status: 'pending_admin_approval',
      source: 'available_balance_refund',
      fundingType: 'self'
    });

    const refundCalls = Array.from({ length: 10 }, async () => {
      const req = {
        params: { id: refund._id },
        body: { status: 'approved' },
        user: adminUser,
        ip: '127.0.0.1',
        connection: {}
      };
      const res = makeMockRes();
      try {
        await adminController.handleRefundApproval(req, res);
        return { success: res.statusVal === 200 || !res.jsonVal?.message?.includes("not found"), status: res.statusVal, response: res.jsonVal };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    const refundResults = await Promise.all(refundCalls);
    const successfulRefunds = refundResults.filter(r => r.success && r.status !== 400).length;
    const blockedRefunds = refundResults.filter(r => r.status === 400).length;

    console.log(`  - Refund Approvals Sent: 10`);
    console.log(`  - Successful Refunds:   ${successfulRefunds} (Expected: 1)`);
    console.log(`  - Blocked Duplicates:   ${blockedRefunds} (Expected: 9)`);

    if (successfulRefunds !== 1 || blockedRefunds !== 9) {
      console.error("  ❌ TEST 2 FAILED: Double refund vulnerability detected!");
    } else {
      console.log("  ✅ TEST 2 PASSED: Concurrency check locked duplicate refunds.");
    }

    // Clean up test refund
    await RefundRequest.deleteOne({ _id: refund._id });


    // ----------------------------------------------------
    // TEST 3: Double Checkout Concurrency
    // ----------------------------------------------------
    console.log("\n[Test 3] Simulating 10 simultaneous subscription checkout calls...");

    // Setup active monthly plan cart
    await Cart.deleteMany({ user: studentUser._id });
    await Cart.create({
      user: studentUser._id,
      templates: [{
        id: 'essential',
        isMonthlyPlan: true,
        billingCycle: "monthly",
        startDate: new Date().toISOString().split('T')[0],
        planId: 'essential',
        main: { 
          price: 500,
          category: 'General',
          name: 'Essential Plan'
        }
      }]
    });

    studentProfile.subscriptionActive = false;
    await studentProfile.save();

    const escrowService = require('../services/escrowService');
    const originalLock = escrowService.lockSubscriptionFunds;
    escrowService.lockSubscriptionFunds = async () => {
      return { 
        success: true, 
        txHash: 'MOCK_TX_HASH_CONCURRENCY_TEST',
        studentWallet: {
          availableBalanceKES: 500
        }
      };
    };

    const checkoutCalls = Array.from({ length: 10 }, async () => {
      const req = {
        user: studentUser
      };
      const res = makeMockRes();
      try {
        await cartController.checkoutCart(req, res);
        return { success: res.statusVal === 200 || !res.jsonVal?.message?.includes("already"), status: res.statusVal, response: res.jsonVal };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    const checkoutResults = await Promise.all(checkoutCalls);
    console.log("  - Checkout Results Responses:", checkoutResults.map(r => ({ status: r.status, response: r.response, error: r.error })));
    const successfulCheckouts = checkoutResults.filter(r => r.status === 200).length;
    const blockedCheckouts = checkoutResults.filter(r => r.status === 400).length;

    console.log(`  - Checkout Requests Sent: 10`);
    console.log(`  - Successful Checkouts:   ${successfulCheckouts} (Expected: 1)`);
    console.log(`  - Blocked Duplicates:     ${blockedCheckouts} (Expected: 9)`);

    if (successfulCheckouts !== 1 || blockedCheckouts !== 9) {
      console.error("  ❌ TEST 3 FAILED: Double checkout vulnerability detected!");
    } else {
      console.log("  ✅ TEST 3 PASSED: Concurrency check locked duplicate checkouts.");
    }

    // Clean up test subscription and cart
    const SubscriptionModel = require('../models/Subscription');
    await SubscriptionModel.deleteMany({ student: studentUser._id });
    await Cart.deleteMany({ user: studentUser._id });
    studentProfile.subscriptionActive = false;
    await studentProfile.save();
    escrowService.lockSubscriptionFunds = originalLock;

    console.log("\n=======================================================");
    console.log("✅ ALL CONCURRENCY SECURITY TESTS COMPLETE");
    console.log("=======================================================");
    process.exit(0);

  } catch (err) {
    console.error("Testing suite error:", err);
    process.exit(1);
  }
}

runConcurrencyTests();
