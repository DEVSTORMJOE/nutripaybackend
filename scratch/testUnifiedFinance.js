// scratch/testUnifiedFinance.js
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const CustomOrder = require('../models/CustomOrder');
const Meal = require('../models/Meal');
const Vendor = require('../models/Vendor');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');

const runTests = async () => {
  console.log("=== STARTING UNIFIED FINANCE ARCHITECTURE TESTS ===");
  
  await connectDB();

  // Create temporary test users
  const testStudent = await User.create({
    name: "Test Student KES",
    email: `student_${Date.now()}@nutri.test`,
    password: "mockPassword123",
    role: "student",
    location: "Science Complex Room 10"
  });

  const testSponsor = await User.create({
    name: "Test Sponsor KES",
    email: `sponsor_${Date.now()}@nutri.test`,
    password: "mockPassword123",
    role: "sponsor"
  });

  const testVendorUser = await User.create({
    name: "Test Vendor KES",
    email: `vendor_${Date.now()}@nutri.test`,
    password: "mockPassword123",
    role: "vendor"
  });

  const testVendorProfile = await Vendor.create({
    user: testVendorUser._id,
    storeName: "Test Express Kitchen",
    status: "approved"
  });

  const testMeal = await Meal.create({
    name: "Ugali Fish Special",
    price: 300,
    category: "main",
    vendor: testVendorProfile._id,
    status: "active"
  });

  try {
    // 1. General Sponsor Funding Flow
    console.log("\n--- TEST 1: General Sponsor Funding Flow ---");
    // Sponsor wallet mock deposit
    await walletService.creditWallet(testSponsor._id, 10000, 'deposit', 'wallet', 'Sponsor signup funds');
    
    // Sponsor funds student wallet (unattached to requests)
    await walletService.debitWallet(testSponsor._id, 3000, 'funding', 'wallet', `Funding student: ${testStudent._id}`);
    const studentCredit = await walletService.creditWallet(testStudent._id, 3000, 'funding', 'wallet', `Funding from sponsor: ${testSponsor._id}`);
    
    console.log("Sponsor funded student wallet with 3000 KES.");
    console.log("Student Wallet Available Balance:", studentCredit.wallet.availableBalanceKES);
    console.log("Student Wallet Locked Balance:", studentCredit.wallet.lockedBalanceKES);
    
    if (studentCredit.wallet.availableBalanceKES !== 3000 || studentCredit.wallet.lockedBalanceKES !== 0) {
      throw new Error("FAIL: General sponsor funding should credit student's spendable availableBalanceKES directly.");
    }
    console.log("SUCCESS: Sponsor funding credits availableBalanceKES successfully!");

    // 2. Subscription Checkout Flow
    console.log("\n--- TEST 2: Subscription Checkout Flow ---");
    // Student locks 2400 KES from available balance for a subscription
    const lockResult = await escrowService.lockSubscriptionFunds(testStudent._id, 2400, null);
    console.log("Student checked out subscription for 2400 KES.");
    console.log("Student Wallet Available Balance after subscription lock:", lockResult.studentWallet.availableBalanceKES);
    console.log("Student Wallet Locked Balance after subscription lock:", lockResult.studentWallet.lockedBalanceKES);

    if (lockResult.studentWallet.availableBalanceKES !== 600 || lockResult.studentWallet.lockedBalanceKES !== 2400) {
      throw new Error("FAIL: Locked balance must increase and available balance must decrease correctly on subscription checkout.");
    }
    console.log("SUCCESS: Subscription checkout locked available KES balance perfectly!");

    // 3. Custom Order Wallet Checkout Flow
    console.log("\n--- TEST 3: Custom Order Wallet Checkout Flow (Student Spendable Surplus) ---");
    // Student uses remaining 600 KES surplus to order custom Ugali Fish meals (cost: 300 KES)
    const customOrderTotal = 300;
    const items = [{ name: "Ugali Fish Special", quantity: 1, price: 300, mealId: testMeal._id }];
    
    // Process wallet custom order (instantly debits available, splits platform 10% / vendor 90%, credits vendor available)
    const orderResult = await walletService.processWalletCustomOrder(
      testStudent._id,
      testVendorUser._id,
      items,
      customOrderTotal,
      "Campus Library"
    );

    console.log("Instant custom order processed via wallet.");
    console.log("Student Wallet Available Balance after order:", orderResult.debitResult.wallet.availableBalanceKES);
    console.log("Vendor Wallet Available Balance after payout:", orderResult.creditResult.wallet.availableBalanceKES);
    console.log("Platform Revenue Commission Split:", orderResult.commission);
    console.log("Vendor Share Split:", orderResult.vendorShare);

    if (orderResult.debitResult.wallet.availableBalanceKES !== 300 || 
        orderResult.creditResult.wallet.availableBalanceKES !== 270 || 
        orderResult.commission !== 30 || 
        orderResult.vendorShare !== 270) {
      throw new Error("FAIL: Custom order revenue splitting or wallet debit/credit failed.");
    }
    console.log("SUCCESS: Custom order wallet checkout, instant payouts, and splits completed perfectly!");

    // 4. Custom Order Direct M-Pesa Checkout Webhook Callback
    console.log("\n--- TEST 4: Custom Order Direct M-Pesa Checkout Webhook Callback ---");
    const mpesaRef = `ws_CO_Direct_Mock_${Date.now()}`;
    
    // Create pending student custom order paid via direct M-Pesa push
    const studentOrder = await CustomOrder.create({
      orderId: `ORD-STUDENT-MPESA-${Date.now()}`,
      user: testStudent._id,
      guestCheckout: false,
      vendor: testVendorProfile._id,
      items,
      totalCost: 300,
      paymentMethod: "mpesa_direct",
      paymentSource: "mpesa_direct",
      status: "pending_payment",
      checkoutRequestID: mpesaRef,
      deliveryLocation: "Gate B Hostel"
    });

    console.log("Direct M-Pesa student custom order registered as pending.");

    // Simulate safaricom webhook callback processor
    const processResult = await walletService.processMpesaDirectCustomOrder(
      mpesaRef,
      300,
      "MPESA_REC_101",
      "254711222333"
    );

    console.log("Webhook callback processed successfully.");
    console.log("Student Order Final Status:", processResult.order.status);
    
    const finalVendorWallet = await walletService.getOrCreateWallet(testVendorUser._id, 'vendor');
    console.log("Vendor Wallet Available Balance after M-Pesa payout:", finalVendorWallet.availableBalanceKES);

    if (processResult.order.status !== 'preparing' || finalVendorWallet.availableBalanceKES !== 540) {
      throw new Error("FAIL: M-Pesa callback did not trigger instant order state changes or vendor payout.");
    }
    console.log("SUCCESS: Direct M-Pesa push checkout & student callback completed beautifully!");

  } catch (err) {
    console.error("\n❌ TESTS FAILED:", err.message);
  } finally {
    // Cleanup temporary test items from DB
    await User.findByIdAndDelete(testStudent._id);
    await User.findByIdAndDelete(testSponsor._id);
    await User.findByIdAndDelete(testVendorUser._id);
    await Vendor.findByIdAndDelete(testVendorProfile._id);
    await Meal.findByIdAndDelete(testMeal._id);
    await Wallet.deleteOne({ user: testStudent._id });
    await Wallet.deleteOne({ user: testSponsor._id });
    await Wallet.deleteOne({ user: testVendorUser._id });
    await CustomOrder.deleteMany({ vendor: testVendorProfile._id });

    mongoose.disconnect();
    console.log("\n=== COMPLETED TESTS ===");
  }
};

runTests();
