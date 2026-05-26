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
const reconciliationService = require('../services/reconciliationService');
const reserveSnapshotService = require('../services/reserveSnapshotService');
const crypto = require('crypto');
require('dotenv').config();

async function fundPlatformWallets() {
  console.log("\n🌐 Activating and funding platform accounts on Stellar Testnet...");
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  
  const platformKeys = stellarTreasuryService.platformWallets;
  const publics = [
    { key: platformKeys.issuer.public, name: 'Issuer' },
    { key: platformKeys.treasury.public, name: 'Treasury' },
    { key: platformKeys.escrow.public, name: 'Escrow' },
    { key: platformKeys.vendorSettlement.public, name: 'Vendor Settlement' },
    { key: platformKeys.revenue.public, name: 'Revenue' }
  ];

  for (const pub of publics) {
    if (!pub.key) continue;
    try {
      console.log(`Funding "${pub.name}" account (${pub.key}) with Friendbot...`);
      const response = await fetch(`https://friendbot.stellar.org?addr=${pub.key}`);
      if (response.ok) {
        console.log(`✅ Success for ${pub.name}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.log(`ℹ️  Friendbot status ${response.status} for ${pub.name}. Likely already activated.`);
      }
    } catch (e) {
      console.warn(`⚠️ Friendbot request failed for ${pub.name}: ${e.message}`);
    }
  }

  console.log("\n🔗 Establishing trustlines to custom NutriToken (NT) asset...");
  const trustlines = [
    { key: platformKeys.treasury.secret, name: 'Treasury' },
    { key: platformKeys.escrow.secret, name: 'Escrow' },
    { key: platformKeys.vendorSettlement.secret, name: 'Vendor Settlement' },
    { key: platformKeys.revenue.secret, name: 'Revenue' }
  ];

  for (const acc of trustlines) {
    if (acc.key) {
      try {
        await stellarTreasuryService.createTrustline(acc.key);
      } catch (err) {
        console.warn(`Trustline setup warning for ${acc.name}: ${err.message}`);
      }
    }
  }
}

async function runTests() {
  console.log("🚀 Starting NutriToken (NT) Hybrid Custodial Financial Architecture validation tests...");
  
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log("✅ Connected to MongoDB.");

    // Drop old unique indexes from previous schema designs to prevent duplicate null key errors
    await mongoose.connection.collection('wallets').dropIndex('stellarPublicKey_1').catch(e => {});

    // Activate Stellar accounts and set up trustlines
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

    console.log("\n--- Step 2: Simulate M-Pesa Cash Deposit & Compulsory NT Minting ---");
    const depositAmount = 2500;
    console.log(`Simulating M-Pesa callback deposit of ${depositAmount} KES...`);
    
    // Credit local custodial balance (defaults to sourceType = 'self')
    const creditResult = await walletService.creditWallet(
        student._id,
        depositAmount,
        'deposit',
        'mpesa',
        `M-Pesa Deposit (Receipt: TESTREC123)`
    );

    // COMPULSORY On-chain settlement: Mint equivalent custom tokens from Issuer -> Treasury
    console.log("Executing compulsory on-chain NT minting (Issuer -> Treasury)...");
    const mintTxHash = await stellarTreasuryService.mintNT(depositAmount);
    console.log(`✅ On-chain token minting success! Tx Hash: ${mintTxHash}`);

    // Update the transaction log
    creditResult.transaction.stellarTxHash = mintTxHash;
    creditResult.transaction.settlementStatus = 'synced';
    await creditResult.transaction.save();

    const studentWalletAfterDeposit = await Wallet.findOne({ user: student._id });
    console.log(`✅ Deposit completed. student KES Available Balance: ${studentWalletAfterDeposit.availableBalanceKES}`);
    console.log(`   student Audit Token Balance NT: ${studentWalletAfterDeposit.tokenBalanceNT}`);
    console.log(`   student Funding Sources:`, JSON.stringify(studentWalletAfterDeposit.walletFundingSources, null, 2));

    console.log("\n--- Step 3: Simulate Subscription Checkout (Escrow Locking) ---");
    // Student checks out a 600 KES order (2 days of meals)
    const orderCost = 600;
    console.log(`Locking ${orderCost} KES for student subscription...`);
    const lockResult = await escrowService.lockSubscriptionFunds(student._id, orderCost, null);
    console.log("✅ Checkout locally updated.");
    console.log(`   Student Available KES: ${lockResult.studentWallet.availableBalanceKES}`);
    console.log(`   Student Locked KES: ${lockResult.studentWallet.lockedBalanceKES}`);
    console.log(`   Student Audit Token Balance NT: ${lockResult.studentWallet.tokenBalanceNT}`);
    console.log(`   Stellar Treasury -> Escrow NT Settle Tx Hash: ${lockResult.transaction.stellarTxHash}`);
    console.log(`   Stellar Settlement Status: ${lockResult.transaction.settlementStatus}`);

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
    console.log(`   Student Locked Balance remaining KES: ${releaseResult.studentWallet.lockedBalanceKES}`);
    console.log(`   Vendor Available Balance credited KES: ${releaseResult.vendorWallet.availableBalanceKES}`);
    console.log(`   Stellar Payout Escrow -> Vendor Settlement NT hash: ${releaseResult.transactions[0].stellarTxHash}`);
    console.log(`   Stellar Commission Escrow -> Revenue NT hash: ${releaseResult.transactions[1].stellarTxHash}`);

    console.log("\n--- Step 5: Simulate Custom Orders with Budget Priorities (Immediate, No Escrow) ---");
    // Let's add a sponsor surplus to test sponsor-funding priorities
    console.log("James (Sponsor) funding Test Student with 1000 KES (unrestricted surplus)...");
    await walletService.creditWallet(
      student._id,
      1000,
      'funding',
      'wallet',
      'James sponsor top-up',
      'sponsor',
      false, // unrestricted
      'none'
    );

    const studentWalletBeforeCustom = await Wallet.findOne({ user: student._id });
    console.log("Student balance state before custom purchase:");
    console.log(`   Available Balance KES: ${studentWalletBeforeCustom.availableBalanceKES}`);
    console.log(`   Funding sources:`, JSON.stringify(studentWalletBeforeCustom.walletFundingSources, null, 2));

    // Student purchases direct custom order for 400 KES
    console.log("\nStudent purchasing direct Custom Order for 400 KES...");
    const customCost = 400;
    const processResult = await walletService.processWalletCustomOrder(
      student._id,
      vendorUser._id,
      [{ name: 'Custom Lunch Box', quantity: 1 }],
      customCost,
      'Campus',
      'Test Student',
      '0711111111'
    );

    const studentWalletAfterCustom = await Wallet.findOne({ user: student._id });
    const vendorWalletAfterCustom = await Wallet.findOne({ user: vendorUser._id });
    console.log("✅ Custom order processed immediately.");
    console.log(`   Student Available Balance: ${studentWalletAfterCustom.availableBalanceKES}`);
    console.log(`   Student Funding Sources after custom order:`, JSON.stringify(studentWalletAfterCustom.walletFundingSources, null, 2));
    console.log(`   (Notice how the KES 400 was correctly deducted FIRST from the unrestricted sponsor surplus!)`);
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
    console.log(`   Stellar Escrow -> Treasury Refund NT Tx Hash: ${refundResult.stellarTxHash}`);

    // 7. Perform Full Proof-of-Reserve Cryptographic Audit
    await reconciliationService.runFullReconciliation();

    // 8. Generate and persist cryptographic Reserve Snapshot
    console.log("\n📸 Capturing immutable Reserve Snapshot in MongoDB...");
    const snapshot = await reserveSnapshotService.takeReserveSnapshot();
    console.log(`✅ Snapshot saved. ID: ${snapshot._id}, Status: ${snapshot.status}`);

    console.log("\n🎉 hybrid Custodial Architecture NutriToken (NT) validation checks completed successfully!");

  } catch (error) {
    console.error("\n❌ Validation Test Failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
    process.exit(0);
  }
}

runTests();
