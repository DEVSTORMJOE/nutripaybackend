const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const Transaction = require('../models/Transaction');
const MpesaDeposit = require('../models/MpesaDeposit');

const mpesaController = require('../controllers/mpesaController');
const deliveryController = require('../controllers/deliveryController');

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

async function runSecurityTests() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log("Connected to MongoDB for Production Security Hardening Tests.");

    // Setup entities
    let studentUser = await User.findOne({ role: 'student' });
    if (!studentUser) {
      studentUser = await User.create({
        name: 'Test Security Student',
        email: 'student_sec@nutripay.local',
        password: 'Password123',
        role: 'student',
        phone: '254722222222'
      });
    }

    let studentWallet = await Wallet.findOne({ user: studentUser._id });
    if (!studentWallet) {
      studentWallet = await Wallet.create({
        user: studentUser._id,
        walletType: 'student',
        availableBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
        lockedBalanceKES: mongoose.Types.Decimal128.fromString("0.00")
      });
    } else {
      studentWallet.availableBalanceKES = mongoose.Types.Decimal128.fromString("0.00");
      studentWallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString("0.00");
      await studentWallet.save();
    }

    let driverUser = await User.findOne({ role: 'delivery' });
    if (!driverUser) {
      driverUser = await User.create({
        name: 'Test Security Driver',
        email: 'driver_sec@nutripay.local',
        password: 'Password123',
        role: 'delivery',
        phone: '254733333333'
      });
    }

    let driverProfile = await DeliveryPersonnel.findOne({ user: driverUser._id });
    if (!driverProfile) {
      driverProfile = await DeliveryPersonnel.create({
        user: driverUser._id,
        approvedStatus: 'approved',
        assignedLocations: []
      });
    }

    console.log("\n=======================================================");
    console.log("🛡️  RUNNING PENETRATION TEST: REPLAY & CODE ABUSE");
    console.log("=======================================================");

    // ----------------------------------------------------
    // TEST 1: Webhook Replay Attacks (CheckoutRequestID & Receipt reuse)
    // ----------------------------------------------------
    console.log("\n[Test 1] Simulating M-Pesa webhook callback replay attack...");
    
    const checkoutRequestID = `MOCK_WS_SEC_${Date.now()}`;
    const mpesaReceiptNumber = `MOCK_REC_SEC_${Date.now()}`;

    // Create a pending deposit record
    await MpesaDeposit.create({
      checkoutRequestID,
      user: studentUser._id,
      amount: 250,
      phone: studentUser.phone,
      status: 'pending'
    });

    const mockCallbackBody = {
      Body: {
        stkCallback: {
          MerchantRequestID: "MockMerchantReqId123",
          CheckoutRequestID: checkoutRequestID,
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 250 },
              { Name: "MpesaReceiptNumber", Value: mpesaReceiptNumber },
              { Name: "PhoneNumber", Value: studentUser.phone }
            ]
          }
        }
      }
    };

    // 1st Callback invocation: should process and credit wallet KES 250
    const req1 = { body: mockCallbackBody, params: { userId: studentUser._id.toString() } };
    const res1 = makeMockRes();
    await mpesaController.mpesaCallback(req1, res1);
    
    // Check wallet balance
    const walletAfterFirst = await Wallet.findOne({ user: studentUser._id });
    const balanceAfterFirst = parseFloat(walletAfterFirst.availableBalanceKES.toString());

    // 2nd Callback invocation (Replay Attack): should be rejected/ignored and not credit balance again
    const req2 = { body: mockCallbackBody, params: { userId: studentUser._id.toString() } };
    const res2 = makeMockRes();
    await mpesaController.mpesaCallback(req2, res2);

    const walletAfterSecond = await Wallet.findOne({ user: studentUser._id });
    const balanceAfterSecond = parseFloat(walletAfterSecond.availableBalanceKES.toString());

    console.log(`  - 1st Webhook Inflow: Balance is KES ${balanceAfterFirst}`);
    console.log(`  - 2nd Webhook Inflow (Replay): Balance is KES ${balanceAfterSecond}`);
    console.log(`  - Webhook Response: ${JSON.stringify(res2.jsonVal)}`);

    if (balanceAfterSecond === balanceAfterFirst && balanceAfterSecond === 250) {
      console.log("  ✅ TEST 1 PASSED: Webhook replay successfully rejected. Duplicate credit blocked.");
    } else {
      console.error("  ❌ TEST 1 FAILED: Double credit allowed on replay!");
    }

    // Clean up test transaction/deposit logs
    await MpesaDeposit.deleteOne({ checkoutRequestID });
    await Transaction.deleteMany({ paymentReference: mpesaReceiptNumber });


    // ----------------------------------------------------
    // TEST 2: Delivery Verification Abuse (Invalid/Expired/Reused codes)
    // ----------------------------------------------------
    console.log("\n[Test 2] Simulating delivery verification validation rules...");

    const testDelivery = await Delivery.create({
      student: studentUser._id,
      vendor: studentUser._id, // mock vendor as student user for simplicity
      location: "Mock Hostel Block X",
      totalCost: 150,
      status: "assigned",
      deliveryAgent: driverUser._id,
      deliveryVerificationCode: "NP-SEC-789",
      deliveryVerificationExpiry: new Date(Date.now() + 3600 * 1000), // 1 hr expiry
      scheduledDate: new Date()
    });

    // 2a. Attempt invalid code
    const req2a = {
      body: { deliveryId: testDelivery._id, code: "NP-FAKE-999" },
      user: driverUser
    };
    const res2a = makeMockRes();
    await deliveryController.markDelivered(req2a, res2a);
    console.log(`  - Invalid Code Attempt Result: status=${res2a.statusVal}, message="${res2a.jsonVal?.message}"`);

    // 2b. Attempt expired code
    testDelivery.deliveryVerificationExpiry = new Date(Date.now() - 60 * 1000); // 1 min ago
    await testDelivery.save();

    const req2b = {
      body: { deliveryId: testDelivery._id, code: "NP-SEC-789" },
      user: driverUser
    };
    const res2b = makeMockRes();
    await deliveryController.markDelivered(req2b, res2b);
    console.log(`  - Expired Code Attempt Result: status=${res2b.statusVal}, message="${res2b.jsonVal?.message}"`);

    // 2c. Attempt valid code on already delivered order (reused code attempt)
    testDelivery.deliveryVerificationExpiry = new Date(Date.now() + 3600 * 1000); // restored
    testDelivery.status = "delivered";
    await testDelivery.save();

    const req2c = {
      body: { deliveryId: testDelivery._id, code: "NP-SEC-789" },
      user: driverUser
    };
    const res2c = makeMockRes();
    await deliveryController.markDelivered(req2c, res2c);
    console.log(`  - Reused Code Attempt Result:  status=${res2c.statusVal}, message="${res2c.jsonVal?.message}"`);

    if (res2a.statusVal === 400 && res2b.statusVal === 400 && res2c.statusVal === 400) {
      console.log("  ✅ TEST 2 PASSED: Abuse check rejected invalid, expired, and reused verification codes.");
    } else {
      console.error("  ❌ TEST 2 FAILED: Validation check allowed verification bypass!");
    }

    // Clean up test delivery
    await Delivery.deleteOne({ _id: testDelivery._id });

    console.log("\n=======================================================");
    console.log("✅ ALL PRODUCTION HARDENING SECURITY TESTS COMPLETE");
    console.log("=======================================================");
    process.exit(0);

  } catch (err) {
    console.error("Security testing suite error:", err);
    process.exit(1);
  }
}

runSecurityTests();
