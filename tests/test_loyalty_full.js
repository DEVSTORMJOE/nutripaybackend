const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config({ path: "../.env" });

const { calculatePoints, awardPoints, processThresholdConversion, getLoyaltyStatus } = require("../services/loyaltyService");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const LoyaltyLog = require("../models/LoyaltyLog");
const Transaction = require("../models/Transaction");

async function runTest() {
  console.log("=== Testing Loyalty Points Module ===");

  // 1. Test calculation engine
  console.log("\n1. Testing calculatePoints():");
  const testCases = [
    { amount: 50, expected: 0 },
    { amount: 100, expected: 1 },
    { amount: 199, expected: 1 },
    { amount: 250, expected: 2 },
    { amount: 350, expected: 3 },
    { amount: 450, expected: 4 },
    { amount: 500, expected: 5 },
    { amount: 1500, expected: 5 },
  ];

  let passed = true;
  for (const tc of testCases) {
    const pts = calculatePoints(tc.amount);
    const ok = pts === tc.expected;
    if (!ok) passed = false;
    console.log(` - KES ${tc.amount} => ${pts} pts (Expected: ${tc.expected}) [${ok ? "PASS" : "FAIL"}]`);
  }

  if (!passed) {
    console.error("❌ Tier calculation tests failed!");
    process.exit(1);
  }

  console.log("✅ All tier calculation rules PASSED!");

  // Connect to DB for integration test
  try {
    const dbUri = process.env.MONGO_URI || "mongodb://localhost:27017/nutripay";
    await mongoose.connect(dbUri);
    console.log("\nConnected to DB for integration testing...");

    // Create temporary test user
    const testUser = await User.create({
      name: "Loyalty Test User",
      email: `loyalty_test_${Date.now()}@example.com`,
      phone: "0700009999",
      password: "password123",
      role: "student",
      loyaltyPoints: 0,
    });

    console.log(`Created test user: ${testUser._id}`);

    // Award 95 points in 19 orders of KES 500 (5 points each)
    console.log("\n2. Awarding 95 points (19 orders x 5 pts)...");
    for (let i = 0; i < 19; i++) {
      await awardPoints({ userId: testUser._id, orderAmountKES: 500 });
    }

    let status = await getLoyaltyStatus(testUser._id);
    console.log(`Current status: ${status.loyaltyPoints} pts, Progress: ${status.progressPercentage}%, Reached: ${status.isThresholdReached}`);

    if (status.loyaltyPoints !== 95 || status.isThresholdReached) {
      console.error(`❌ Expected 95 pts and threshold not reached, got ${status.loyaltyPoints}`);
      process.exit(1);
    }
    console.log("✅ 95 pts accumulated without premature wallet conversion!");

    // Test 100+ threshold conversion where order introduces user to 103 points (98 + 5 pts)
    console.log("\n3. Testing order that introduces user to 100+ points (98 pts + 5 pts = 103 pts)...");
    await User.findByIdAndUpdate(testUser._id, { loyaltyPoints: 98 });
    await awardPoints({ userId: testUser._id, orderAmountKES: 500 }); // +5 pts -> 103 pts -> auto converts all 103 pts to 103 KES

    status = await getLoyaltyStatus(testUser._id);
    console.log(`Status after crossing threshold: ${status.loyaltyPoints} pts remaining, Total Earned: ${status.totalEarned}, Total Converted: ${status.totalConverted}`);

    const wallet = await Wallet.findOne({ user: testUser._id });
    const availBal = wallet ? parseFloat(wallet.availableBalanceKES.toString()) : 0;
    console.log(`User active Wallet available balance: KES ${availBal}`);

    if (status.loyaltyPoints === 0 && status.totalConverted === 103 && availBal === 103) {
      console.log("✅ Auto-conversion of ALL 103 accumulated points to 103 KES wallet credit PASSED!");
    } else {
      console.error(`❌ Auto-conversion test failed! Expected 0 pts remaining, 103 converted, got ${status.loyaltyPoints} pts remaining, ${status.totalConverted} converted, ${availBal} balance`);
      process.exit(1);
    }

    // Clean up test records
    await User.findByIdAndDelete(testUser._id);
    await Wallet.deleteMany({ user: testUser._id });
    await LoyaltyLog.deleteMany({ userId: testUser._id });
    await Transaction.deleteMany({ toUser: testUser._id });
    console.log("\nTest user & test data cleaned up successfully.");

    await mongoose.disconnect();
    console.log("=== Loyalty Points Integration Test COMPLETED SUCCESSFULLY ===");
  } catch (err) {
    console.error("Integration test error:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTest();
