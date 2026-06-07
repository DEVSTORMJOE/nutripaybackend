const mongoose = require('mongoose');
const Delivery = require('../models/Delivery');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const Subscription = require('../models/Subscription');
const Vendor = require('../models/Vendor');
const RefundRequest = require('../models/RefundRequest');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');
const studentController = require('../controllers/studentController');

// Test Setup
const mockReq = (body, user) => ({ body, user });
const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

async function setupTestDB() {
  const MONGO_URI = 'mongodb://127.0.0.1:27017/nutripay_test_db';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  }
  
  // Clear DB
  await Delivery.deleteMany({});
  await Wallet.deleteMany({});
  await Transaction.deleteMany({});
  await Student.deleteMany({});
  await Subscription.deleteMany({});
  await Vendor.deleteMany({});
  await RefundRequest.deleteMany({});
}

async function runTests() {
  await setupTestDB();

  console.log("Starting Opt-Out and Meal Flow Regression Tests...");

  // Setup Mock User
  const studentUser = new mongoose.Types.ObjectId();
  const vendorUser = new mongoose.Types.ObjectId();

  await Student.create({ user: studentUser, name: "Test Student" });
  await Vendor.create({ _id: vendorUser, user: vendorUser, name: "Test Vendor" });

  // 1. Credit wallet
  await walletService.creditWallet(studentUser, 5000, 'deposit', 'mpesa', 'Initial deposit');
  let wallet = await Wallet.findOne({ user: studentUser });
  if (wallet.availableBalanceKES !== 5000) throw new Error("Wallet not credited correctly");

  console.log("✅ Deposit successful. Available:", wallet.availableBalanceKES);

  // 2. Create Subscription
  const sub = await Subscription.create({
    student: studentUser,
    status: 'active',
    startDate: new Date(),
    endDate: new Date(Date.now() + 28 * 86400000),
    totalCost: 500,
    planId: 'elite'
  });

  // 3. Create Deliveries with various statuses
  const dPending = await Delivery.create({
    student: studentUser,
    vendor: vendorUser,
    status: 'pending',
    scheduledDate: new Date(Date.now() + 86400000),
    totalCost: 100,
    items: [{ name: 'Lunch', price: 100 }]
  });

  const dAssigned = await Delivery.create({
    student: studentUser,
    vendor: vendorUser,
    status: 'assigned',
    scheduledDate: new Date(Date.now() + 2 * 86400000),
    totalCost: 100,
    items: [{ name: 'Lunch', price: 100 }]
  });

  const dPreparing = await Delivery.create({
    student: studentUser,
    vendor: vendorUser,
    status: 'preparing',
    scheduledDate: new Date(Date.now() + 3 * 86400000),
    totalCost: 100,
    items: [{ name: 'Lunch', price: 100 }]
  });

  const dReady = await Delivery.create({
    student: studentUser,
    vendor: vendorUser,
    status: 'ready',
    scheduledDate: new Date(Date.now() + 4 * 86400000),
    totalCost: 100,
    items: [{ name: 'Lunch', price: 100 }]
  });

  const dPickedUp = await Delivery.create({
    student: studentUser,
    vendor: vendorUser,
    status: 'picked_up',
    scheduledDate: new Date(Date.now() + 5 * 86400000),
    totalCost: 100,
    items: [{ name: 'Lunch', price: 100 }]
  });

  const dDelivered = await Delivery.create({
    student: studentUser,
    vendor: vendorUser,
    status: 'delivered',
    scheduledDate: new Date(Date.now() - 86400000),
    totalCost: 100,
    items: [{ name: 'Lunch', price: 100 }]
  });

  // Lock funds for all 6 deliveries (total 600)
  await escrowService.lockSubscriptionFunds(studentUser, 600);
  
  wallet = await Wallet.findOne({ user: studentUser });
  if (wallet.availableBalanceKES !== 4400) throw new Error("Available balance not reduced by lock");
  if (wallet.lockedBalanceKES !== 600) throw new Error("Locked balance not increased by lock");

  console.log("✅ Subscription locked. Available:", wallet.availableBalanceKES, "Locked:", wallet.lockedBalanceKES);

  // 4. Run optOut controller method
  const req = mockReq({}, { id: studentUser });
  const res = mockRes();
  await studentController.optOut(req, res);

  // Verify response
  if (res.statusCode && res.statusCode !== 200) {
    throw new Error(`OptOut controller failed with status ${res.statusCode}: ${res.data?.message}`);
  }

  // 5. Verify Database changes
  // Retrieve deliveries after opt-out
  const deliveriesAfter = await Delivery.find({ student: studentUser });
  
  const checkStatus = (id, expected) => {
    const d = deliveriesAfter.find(item => item._id.equals(id));
    if (!d) throw new Error(`Delivery ${id} not found after opt-out`);
    if (d.status !== expected) {
      throw new Error(`Expected status of ${id} to be ${expected}, but got ${d.status}`);
    }
  };

  // Only 'pending' and 'assigned' should have been set to 'cancelled'
  checkStatus(dPending._id, 'cancelled');
  checkStatus(dAssigned._id, 'cancelled');

  // 'preparing', 'ready', 'picked_up' and 'delivered' should remain unaffected
  checkStatus(dPreparing._id, 'preparing');
  checkStatus(dReady._id, 'ready');
  checkStatus(dPickedUp._id, 'picked_up');
  checkStatus(dDelivered._id, 'delivered');

  console.log("✅ Delivery statuses verified correctly. Preparing/ready/picked_up remained active!");

  // Verify RefundRequest
  const refundReq = await RefundRequest.findOne({ student: studentUser });
  if (!refundReq) throw new Error("Refund Request was not created");
  
  // The amount should only be KES 200 (pending and assigned only)
  if (refundReq.amountKES !== 200) {
    throw new Error(`Expected refund request amount to be 200 KES, but got ${refundReq.amountKES}`);
  }

  // The refund request should only reference the two cancelled deliveries
  const refIds = refundReq.deliveryIds.map(id => id.toString());
  if (refIds.length !== 2) throw new Error(`Expected 2 delivery IDs in refund request, got ${refIds.length}`);
  if (!refIds.includes(dPending._id.toString())) throw new Error("Missing dPending in refundRequest");
  if (!refIds.includes(dAssigned._id.toString())) throw new Error("Missing dAssigned in refundRequest");

  console.log("✅ Refund Request verified correctly. Capped to KES 200 and mapped only cancelled deliveries!");

  // Verify Subscription cancelled
  const updatedSub = await Subscription.findById(sub._id);
  if (updatedSub.status !== 'cancelled') throw new Error("Subscription status not set to cancelled");

  console.log("✅ Subscription cancellation verified correctly!");

  console.log("All Tests Passed!");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test Failed:", err);
  process.exit(1);
});
