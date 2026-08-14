const path = require('path');
const backendDir = 'c:/Users/dell/Desktop/Nutri/back/nutripaybackend';
const mongoose = require(path.join(backendDir, 'node_modules/mongoose'));
const fs = require('fs');
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });

const LOG_FILE = 'c:/Users/dell/Desktop/Nutri/back/nutripaybackend/manual_payouts_test_results.log';
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, line);
}

fs.writeFileSync(LOG_FILE, "=== MANUAL PAYOUT & REFUND APPROVAL WORKFLOW INTENSE TEST SUITE ===\n\n");

async function runManualPayoutTests() {
  log("Connecting to MongoDB database...");
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay';
  await mongoose.connect(mongoUri);
  log("✅ Connected to MongoDB.");

  const User = require(path.join(backendDir, 'models/User'));
  const Student = require(path.join(backendDir, 'models/Student'));
  const Wallet = require(path.join(backendDir, 'models/Wallet'));
  const Delivery = require(path.join(backendDir, 'models/Delivery'));
  const WithdrawalRequest = require(path.join(backendDir, 'models/WithdrawalRequest'));
  const RefundRequest = require(path.join(backendDir, 'models/RefundRequest'));
  const adminController = require(path.join(backendDir, 'controllers/adminController'));

  // Helper for mock Express req/res
  const createMockReqRes = (params = {}, body = {}, user = { id: new mongoose.Types.ObjectId().toString() }) => {
    let resData = null;
    let resCode = 200;
    const req = { 
      params, 
      body, 
      user, 
      ip: '127.0.0.1', 
      connection: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'TestAgent/1.0' }
    };
    const res = {
      status: (code) => {
        resCode = code;
        return res;
      },
      json: (data) => {
        resData = data;
        return res;
      }
    };
    return { req, res, getResponse: () => ({ code: resCode, data: resData }) };
  };

  // Setup Test User and Wallet
  const testUser = await User.create({
    name: "Manual Payout Test User",
    email: `testpayout_${Date.now()}@example.com`,
    password: "Password123!",
    role: "vendor",
    isApproved: true
  });

  const testWallet = await Wallet.create({
    user: testUser._id,
    walletType: "vendor",
    availableBalanceKES: mongoose.Types.Decimal128.fromString("1000.00"),
    pendingWithdrawalKES: mongoose.Types.Decimal128.fromString("500.00"),
    status: "active"
  });

  // Test 1: Vendor Withdrawal Request Approval (Manual Dispatch Workflow)
  log("\n--- TEST 1: Vendor Withdrawal Request Approval (Manual Dispatch) ---");
  const withdrawalReq = await WithdrawalRequest.create({
    user: testUser._id,
    amountKES: mongoose.Types.Decimal128.fromString("500.00"),
    phone: "254718930888",
    status: "requested"
  });

  const { req: wReq, res: wRes, getResponse: getWRes } = createMockReqRes(
    { id: withdrawalReq._id.toString() },
    { status: 'approved' }
  );

  try {
    await adminController.handleWithdrawalRequest(wReq, wRes);
    const result = getWRes();
    log("Withdrawal Approval Response: " + JSON.stringify(result));

    const updatedReq = await WithdrawalRequest.findById(withdrawalReq._id);
    const updatedWallet = await Wallet.findById(testWallet._id);
    const pendingRemaining = parseFloat(updatedWallet.pendingWithdrawalKES.toString());

    if (updatedReq.status === 'approved' && pendingRemaining === 0) {
      log("✅ TEST 1 PASSED: Withdrawal request approved without triggering automated B2C call. Pending balance deducted to 0 KES.");
    } else {
      log(`❌ TEST 1 FAILED: Request status=${updatedReq.status}, wallet pendingRemaining=${pendingRemaining}`);
    }
  } catch (err) {
    log("❌ TEST 1 EXCEPTION: " + err.message);
  }

  // Setup Test Student and Subscription Refund Request
  log("\n--- TEST 2: Student Subscription Refund Request Approval ---");
  const studentUser = await User.create({
    name: "Manual Refund Test Student",
    email: `teststudent_${Date.now()}@example.com`,
    password: "Password123!",
    role: "student",
    isApproved: true
  });

  const studentProfile = await Student.create({
    user: studentUser._id,
    phoneNumber: "254712999888",
    subscriptionActive: true
  });

  const studentWallet = await Wallet.create({
    user: studentUser._id,
    walletType: "student",
    availableBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
    lockedBalanceKES: mongoose.Types.Decimal128.fromString("1000.00"),
    status: "active"
  });

  const dummyVendorId = new mongoose.Types.ObjectId();

  // Create 2 pending delivery records with totalCost, scheduledDate and vendor
  const d1 = await Delivery.create({
    student: studentUser._id,
    vendor: dummyVendorId,
    scheduledDate: new Date(),
    status: 'pending',
    totalCost: mongoose.Types.Decimal128.fromString("500.00"),
    subtotalKes: mongoose.Types.Decimal128.fromString("500.00"),
    items: [{ name: 'Test Meal', price: 500 }]
  });
  const d2 = await Delivery.create({
    student: studentUser._id,
    vendor: dummyVendorId,
    scheduledDate: new Date(),
    status: 'pending',
    totalCost: mongoose.Types.Decimal128.fromString("500.00"),
    subtotalKes: mongoose.Types.Decimal128.fromString("500.00"),
    items: [{ name: 'Test Meal 2', price: 500 }]
  });

  const refundReq = await RefundRequest.create({
    student: studentUser._id,
    amountKES: 1000,
    fundingType: 'self',
    reason: 'Opt-out test',
    type: 'subscription_cancellation',
    deliveryIds: [d1._id, d2._id],
    status: 'pending_admin_approval'
  });

  const { req: rReq, res: rRes, getResponse: getRRes } = createMockReqRes(
    { id: refundReq._id.toString() },
    { status: 'approved' }
  );

  try {
    await adminController.handleRefundApproval(rReq, rRes);
    const result = getRRes();
    log("Refund Approval Response: " + JSON.stringify(result));

    const updatedRefundReq = await RefundRequest.findById(refundReq._id);
    const updatedStudentProfile = await Student.findOne({ user: studentUser._id });
    const updatedStudentWallet = await Wallet.findById(studentWallet._id);

    const availableAfter = parseFloat(updatedStudentWallet.availableBalanceKES.toString());
    const lockedAfter = parseFloat(updatedStudentWallet.lockedBalanceKES.toString());

    if (updatedRefundReq.status === 'approved' && updatedStudentProfile.subscriptionActive === false && lockedAfter === 0 && availableAfter === 1000) {
      log("✅ TEST 2 PASSED: Subscription refund approved successfully. Locked balance returned to available wallet balance and subscription deactivated.");
    } else {
      log(`❌ TEST 2 FAILED: Refund req status=${updatedRefundReq.status}, subscriptionActive=${updatedStudentProfile.subscriptionActive}, available=${availableAfter}, locked=${lockedAfter}`);
    }
  } catch (err) {
    log("❌ TEST 2 EXCEPTION: " + err.message);
  }

  // Cleanup Test Documents
  log("\nCleaning up test documents from database...");
  await User.deleteMany({ _id: { $in: [testUser._id, studentUser._id] } });
  await Student.deleteMany({ _id: studentProfile._id });
  await Wallet.deleteMany({ _id: { $in: [testWallet._id, studentWallet._id] } });
  await Delivery.deleteMany({ _id: { $in: [d1._id, d2._id] } });
  await WithdrawalRequest.deleteMany({ _id: withdrawalReq._id });
  await RefundRequest.deleteMany({ _id: refundReq._id });
  log("✅ Cleanup complete.");

  log("\n=== MANUAL PAYOUT & REFUND APPROVAL TEST SUITE COMPLETED ===");
  await mongoose.disconnect();
}

runManualPayoutTests().catch(err => {
  log("FATAL TEST RUN ERROR: " + err.message);
  process.exit(1);
});
