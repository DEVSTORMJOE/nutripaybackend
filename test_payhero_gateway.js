const path = require('path');
const backendDir = 'c:/Users/dell/Desktop/Nutri/back/nutripaybackend';
const mongoose = require(path.join(backendDir, 'node_modules/mongoose'));
const fs = require('fs');
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });

const LOG_FILE = 'c:/Users/dell/Desktop/Nutri/back/nutripaybackend/payhero_gateway_test_results.log';
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, line);
}

fs.writeFileSync(LOG_FILE, "=== PAYHERO & MULTI-GATEWAY SYSTEM INTENSE TEST SUITE ===\n\n");

async function runGatewayTests() {
  log("Connecting to MongoDB database...");
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay';
  await mongoose.connect(mongoUri);
  log("✅ Connected to MongoDB.");

  const paymentGatewayService = require(path.join(backendDir, 'services/paymentGatewayService'));
  const payheroService = require(path.join(backendDir, 'services/payheroService'));
  const SystemSettings = require(path.join(backendDir, 'models/SystemSettings'));

  // Test 1: M-Pesa Gateway Routing
  log("\n--- TEST 1: Default / Explicit M-Pesa Gateway Routing ---");
  await SystemSettings.setSetting('active_payment_gateway', 'mpesa', 'Default gateway');
  let activeGateway = await paymentGatewayService.getActiveGateway();
  log(`Active Gateway retrieved: '${activeGateway}'`);
  if (activeGateway === 'mpesa') {
    log("✅ TEST 1 PASSED: Correctly retrieved 'mpesa' from SystemSettings.");
  } else {
    log("❌ TEST 1 FAILED: Expected 'mpesa', got: " + activeGateway);
  }

  // Test 2: PayHero Gateway Switch & Routing
  log("\n--- TEST 2: PayHero Gateway Switching ---");
  await SystemSettings.setSetting('active_payment_gateway', 'payhero', 'PayHero active gateway');
  activeGateway = await paymentGatewayService.getActiveGateway();
  log(`Active Gateway retrieved: '${activeGateway}'`);
  if (activeGateway === 'payhero') {
    log("✅ TEST 2 PASSED: Correctly retrieved 'payhero' after admin toggle.");
  } else {
    log("❌ TEST 2 FAILED: Expected 'payhero', got: " + activeGateway);
  }

  // Test 3: PayHero STK Push Initiation Format
  log("\n--- TEST 3: PayHero STK Push Initiation ---");
  const dummyUserId = new mongoose.Types.ObjectId().toString();
  const dummyPhone = "254712345678";
  const amount = 1500;

  try {
    const stkResponse = await payheroService.initiateDeposit(dummyUserId, dummyPhone, amount, 'monthly_subscription');
    log("PayHero STK Response: " + JSON.stringify(stkResponse));
    if (stkResponse.success && stkResponse.provider === 'payhero' && stkResponse.CheckoutRequestID) {
      log("✅ TEST 3 PASSED: PayHero STK Push payload created and CheckoutRequestID returned.");
    } else {
      log("❌ TEST 3 FAILED: Invalid STK response from PayHero.");
    }
  } catch (err) {
    log("❌ TEST 3 EXCEPTION: " + err.message);
  }

  // Test 4: Unified paymentGatewayService.initiateDeposit with PayHero
  log("\n--- TEST 4: Unified Gateway router STK Push dispatch ---");
  try {
    const unifiedRes = await paymentGatewayService.initiateDeposit(dummyUserId, dummyPhone, 2000, 'monthly_subscription');
    log("Unified STK Response: " + JSON.stringify(unifiedRes));
    if (unifiedRes.success && unifiedRes.provider === 'payhero') {
      log("✅ TEST 4 PASSED: Unified router dispatched deposit to PayHero seamlessly.");
    } else {
      log("❌ TEST 4 FAILED: Unified router failed to dispatch to PayHero.");
    }
  } catch (err) {
    log("❌ TEST 4 EXCEPTION: " + err.message);
  }

  // Test 5: PayHero Webhook Callback Verification
  log("\n--- TEST 5: PayHero Webhook Callback Verification ---");
  const mockPayHeroCallbackBody = {
    response: {
      status: "SUCCESS",
      amount: 2000,
      checkout_id: "PH_CO_MOCK_TEST_123",
      external_reference: `monthly_subscription_${dummyUserId}_12345`,
      mpesa_code: "PH99988877",
      phone_number: "254712345678"
    }
  };

  try {
    const verified = paymentGatewayService.verifyCallback(mockPayHeroCallbackBody, 'payhero');
    log("Callback Verification Result: " + JSON.stringify(verified));
    if (verified.success && verified.provider === 'payhero' && verified.amountPaid === 2000 && verified.mpesaReceiptNumber === "PH99988877") {
      log("✅ TEST 5 PASSED: PayHero webhook payload parsed and verified successfully.");
    } else {
      log("❌ TEST 5 FAILED: Callback verification returned unexpected payload.");
    }
  } catch (err) {
    log("❌ TEST 5 EXCEPTION: " + err.message);
  }

  // Reset setting back to mpesa as standard default
  await SystemSettings.setSetting('active_payment_gateway', 'mpesa', 'Default gateway');
  log("\nReset active_payment_gateway to 'mpesa'.");

  log("\n=== PAYHERO & MULTI-GATEWAY TEST SUITE COMPLETED ===");
  await mongoose.disconnect();
}

runGatewayTests().catch(err => {
  log("FATAL TEST RUN ERROR: " + err.message);
  process.exit(1);
});
