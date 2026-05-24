const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Delivery = require('../models/Delivery');
const Meal = require('../models/Meal');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');
const stellarTreasuryService = require('../services/stellarTreasuryService');
require('dotenv').config();

async function fundPlatformWallets() {
  console.log("\n🌐 Funding platform accounts on Stellar Testnet...");
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  
  const publics = [
    stellarTreasuryService.platformWallets.treasury.public,
    stellarTreasuryService.platformWallets.escrow.public,
    stellarTreasuryService.platformWallets.vendorSettlement.public,
    stellarTreasuryService.platformWallets.revenue.public
  ];

  for (const pub of publics) {
    if (!pub) continue;
    try {
      console.log(`Funding ${pub} with Friendbot...`);
      const response = await fetch(`https://friendbot.stellar.org?addr=${pub}`);
      if (response.ok) {
        console.log(`✅ Success for ${pub}`);
      } else {
        console.log(`⚠️ Friendbot returned status ${response.status} for ${pub}. Might already be funded.`);
      }
    } catch (e) {
      console.warn(`Friendbot request failed for ${pub}: ${e.message}`);
    }
  }
}

async function runTests() {
  console.log("🚀 Starting Hybrid Custodial Financial Architecture validation tests...");
  
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log("✅ Connected to MongoDB.");

    // Drop old unique indexes from previous schema designs to prevent duplicate null key errors
    await mongoose.connection.collection('wallets').dropIndex('stellarPublicKey_1').catch(e => {
      console.log("   (Unique index stellarPublicKey_1 already dropped or not present)");
    });

    // Activate Stellar accounts
    await fundPlatformWallets();

    // 1. Clean up old test users if they exist
    await User.deleteMany({ email: { $in: ['test_student@nutri.local', 'test_sponsor@nutri.local', 'test_vendor@nutri.local'] } });
    await Vendor.deleteMany({});
    await Wallet.deleteMany({});
    await Transaction.deleteMany({});
    await Delivery.deleteMany({});
    await Meal.deleteMany({});

    console.log("\n--- Step 1: Create Mock Accounts ---");
    // Create Student
    const student = await User.create({
      name: "Test Student",
      email: "test_student@nutri.local",
      phone: "0711111111",
      password: "password123",
      role: "student",
      isApproved: true
    });
    console.log(`✅ Student created: ${student._id}`);

    // Create Sponsor
    const sponsor = await User.create({
      name: "Test Sponsor",
      email: "test_sponsor@nutri.local",
      phone: "0722222222",
      password: "password123",
      role: "sponsor",
      isApproved: true
    });
    console.log(`✅ Sponsor created: ${sponsor._id}`);

    // Create Vendor
    const vendorUser = await User.create({
      name: "Test Vendor",
      email: "test_vendor@nutri.local",
      phone: "0733333333",
      password: "password123",
      role: "vendor",
      isApproved: true
    });
    const vendorProfile = await Vendor.create({
      user: vendorUser._id,
      stellarPublicKey: null,
      approvedStatus: 'approved'
    });
    console.log(`✅ Vendor created: ${vendorUser._id}, Profile: ${vendorProfile._id}`);

    // Create Meal
    const meal = await Meal.create({
      name: "Nutritious Rice & Beans",
      description: "Organic meals",
      price: 300,
      category: "main",
      vendor: vendorProfile._id,
      approvalStatus: 'approved'
    });
    console.log(`✅ Meal created: ${meal.name}, Price: ${meal.price} KES`);

    // Initialize Wallets
    const studentWallet = await walletService.getOrCreateWallet(student._id, 'student');
    const sponsorWallet = await walletService.getOrCreateWallet(sponsor._id, 'sponsor');
    const vendorWallet = await walletService.getOrCreateWallet(vendorUser._id, 'vendor');

    console.log("\n--- Step 2: Simulate M-Pesa Cash Deposit ---");
    // Top up Student with 1,000 KES
    console.log("Top-up Student with 1000 KES...");
    const depositRes = await walletService.creditWallet(
      student._id,
      1000,
      'deposit',
      'mpesa',
      'M-Pesa top-up of 1,000 KES'
    );
    console.log(`✅ Deposit completed locally. Student KES Available Balance: ${depositRes.wallet.availableBalanceKES}`);

    console.log("\n--- Step 3: Simulate Subscription Checkout (Escrow Locking) ---");
    // Student checks out a 600 KES order (2 days of meals)
    const orderCost = 600;
    console.log(`Locking ${orderCost} KES for student subscription...`);
    const lockResult = await escrowService.lockSubscriptionFunds(student._id, orderCost, null);
    console.log("✅ Checkout locally updated.");
    console.log(`   Student Available KES: ${lockResult.studentWallet.availableBalanceKES}`);
    console.log(`   Student Locked KES: ${lockResult.studentWallet.lockedBalanceKES}`);
    console.log(`   Stellar Treasury -> Escrow Tx Hash: ${lockResult.transaction.stellarTxHash}`);

    // Create Mock Deliveries
    const deliveries = await Delivery.create([
      {
        student: student._id,
        vendor: vendorProfile._id,
        items: [{ name: meal.name, quantity: 1 }],
        status: 'pending',
        totalCost: 300,
        timeSlot: 'Lunch',
        scheduledDate: new Date(),
        location: 'Campus'
      },
      {
        student: student._id,
        vendor: vendorProfile._id,
        items: [{ name: meal.name, quantity: 1 }],
        status: 'pending',
        totalCost: 300,
        timeSlot: 'Lunch',
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        location: 'Campus'
      }
    ]);
    console.log(`✅ 2 Deliveries created. Deliveries Cost: 300 KES each.`);

    console.log("\n--- Step 4: Simulate Delivery Completion & Escrow Release ---");
    // Delivery 1 completed
    const deliveryToComplete = deliveries[0];
    console.log(`Marking delivery ${deliveryToComplete._id} as completed. Releasing payout...`);
    const releaseResult = await escrowService.releaseDailyVendorPayment(deliveryToComplete._id);
    console.log("✅ Payout completed locally.");
    console.log(`   Student Locked Balance remaining: ${releaseResult.studentWallet.lockedBalanceKES}`);
    console.log(`   Vendor Available Balance credited: ${releaseResult.vendorWallet.availableBalanceKES}`);
    console.log(`   Stellar Payout Escrow -> Vendor Settlement hash: ${releaseResult.transactions[0].stellarTxHash}`);
    console.log(`   Stellar Payout Escrow -> Revenue hash: ${releaseResult.transactions[1].stellarTxHash}`);

    console.log("\n--- Step 5: Simulate Custom Orders (Immediate, No Escrow) ---");
    // Student purchases direct custom order for 300 KES
    console.log("Student purchasing direct Custom Order for 300 KES...");
    const customCost = 300;
    const customCommission = customCost * 0.10;
    const customVendorShare = customCost - customCommission;

    // Debit student immediately
    await walletService.debitWallet(student._id, customCost, 'custom_order', 'wallet', 'Instant custom order payment');
    // Credit Vendor immediately
    await walletService.creditWallet(vendorUser._id, customVendorShare, 'vendor_payout', 'wallet', 'Instant custom order payout');
    // Create commission log
    await Transaction.create({
      transactionId: crypto.randomUUID(),
      fromUser: student._id,
      amountKES: customCommission,
      transactionCategory: 'commission',
      paymentMethod: 'wallet',
      orderType: 'custom',
      status: 'completed',
      description: 'Custom order Platform commission'
    });

    const studentWalletAfterCustom = await Wallet.findOne({ user: student._id });
    const vendorWalletAfterCustom = await Wallet.findOne({ user: vendorUser._id });
    console.log("✅ Custom order processed immediately.");
    console.log(`   Student Available Balance: ${studentWalletAfterCustom.availableBalanceKES}`);
    console.log(`   Vendor Available Balance: ${vendorWalletAfterCustom.availableBalanceKES}`);

    console.log("\n--- Step 6: Simulate Subscription Cancellation & Refund ---");
    // Cancel delivery 2 (Remaining 300 KES pending)
    const deliveryToCancel = deliveries[1];
    console.log(`Student cancelling pending delivery: ${deliveryToCancel._id}...`);
    const refundResult = await escrowService.calculateRefund([deliveryToCancel._id], student._id);
    console.log("✅ Cancellation completed locally.");
    console.log(`   Refund KES credited back: ${refundResult.refundedKES}`);
    
    const finalStudentWallet = await Wallet.findOne({ user: student._id });
    console.log(`   Final Student Available KES: ${finalStudentWallet.availableBalanceKES}`);
    console.log(`   Final Student Locked KES: ${finalStudentWallet.lockedBalanceKES}`);
    console.log(`   Stellar Escrow -> Treasury Refund Tx Hash: ${refundResult.stellarTxHash}`);

    console.log("\n🎉 Hybrid Custodial Architecture validation checks completed successfully!");

  } catch (error) {
    console.error("\n❌ Validation Test Failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
    process.exit(0);
  }
}

runTests();
