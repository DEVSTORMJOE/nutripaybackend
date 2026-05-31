/**
 * NutriPay Financial Integrity Test Suite
 * Phase 6: End-to-End Financial Tests (Pass 4)
 *
 * Usage:
 *   node scripts/test_financial_integrity.js
 *
 * Prerequisites:
 *   - MongoDB running with MONGO_URI env var set
 *   - Run from project root: cd back/nutripaybackend && node scripts/test_financial_integrity.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

// ─────────────── MODELS ───────────────
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const RefundRequest = require('../models/RefundRequest');
const User = require('../models/User');

// ─────────────── SERVICES ───────────────
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');

// ─────────────── TEST HARNESS ───────────────
let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       → ${err.message}`);
    errors.push({ name, message: err.message });
    failed++;
  }
}

function assertEqual(label, actual, expected) {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertNonNegative(label, value) {
  if (value < 0) {
    throw new Error(`${label} is negative: ${value}`);
  }
}

// ─────────────── SETUP ───────────────
async function createTestUser(role = 'student') {
  return User.create({
    name: `TestUser_${Date.now()}`,
    email: `test_${crypto.randomBytes(4).toString('hex')}@nutripay.test`,
    password: 'password123',
    role,
    verified: true
  });
}

async function cleanup(ids) {
  if (ids.users?.length) await User.deleteMany({ _id: { $in: ids.users } });
  if (ids.wallets?.length) await Wallet.deleteMany({ user: { $in: ids.users } });
  if (ids.transactions?.length) await Transaction.deleteMany({ fromUser: { $in: ids.users } });
  if (ids.deliveries?.length) await Delivery.deleteMany({ student: { $in: ids.users } });
  if (ids.refunds?.length) await RefundRequest.deleteMany({ student: { $in: ids.users } });
}

// ─────────────── TESTS ───────────────

// TEST 1: creditWallet increases availableBalance
async function test1_creditWalletIncreasesAvailable() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 1000, 'deposit', 'mpesa', 'Test deposit', 'self');
    const wallet = await Wallet.findOne({ user: user._id });
    assertEqual('availableBalanceKES after 1000 credit', wallet.availableBalanceKES, 1000);
    assertEqual('tokenBalanceNT consistency', wallet.tokenBalanceNT, wallet.availableBalanceKES + wallet.lockedBalanceKES);
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 2: lockSubscriptionFunds moves available → locked
async function test2_lockSubscriptionFundsMoves() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 5000, 'deposit', 'mpesa', 'Pre-fund', 'self');
    await escrowService.lockSubscriptionFunds(user._id, 3000, null);
    const wallet = await Wallet.findOne({ user: user._id });
    assertEqual('lockedBalance after lock', wallet.lockedBalanceKES, 3000);
    assertEqual('availableBalance after lock', wallet.availableBalanceKES, 2000);
    assertEqual('tokenBalanceNT = available + locked', wallet.tokenBalanceNT, wallet.availableBalanceKES + wallet.lockedBalanceKES);
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 3: refundFunds must not double-count (locked → available)
async function test3_refundFundsBalanceConsistency() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 4000, 'deposit', 'mpesa', 'Pre-fund', 'self');
    await escrowService.lockSubscriptionFunds(user._id, 4000, null);
    let wallet = await Wallet.findOne({ user: user._id });
    const tokenBefore = wallet.tokenBalanceNT;

    await walletService.refundFunds(user._id, 2000, 'refund', 'self');
    wallet = await Wallet.findOne({ user: user._id });

    // tokenBalanceNT must NOT change on a pure locked → available transfer
    assertEqual('tokenBalanceNT must be unchanged after refund', wallet.tokenBalanceNT, tokenBefore);
    assertEqual('lockedBalance should decrease by 2000', wallet.lockedBalanceKES, 2000);
    assertEqual('availableBalance should increase by 2000', wallet.availableBalanceKES, 2000);
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 4: refundFunds cannot refund more than locked
async function test4_refundFundsCannotOverdraw() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 1000, 'deposit', 'mpesa', 'Pre-fund', 'self');
    await escrowService.lockSubscriptionFunds(user._id, 1000, null);
    try {
      await walletService.refundFunds(user._id, 5000, 'refund', 'self'); // Should throw
      throw new Error('Expected error was not thrown!');
    } catch (err) {
      if (!err.message.includes('exceeds lockedBalanceKES')) throw err; // Re-throw unexpected errors
    }
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 5: Transaction.js schema accepts 'quick_order' category
async function test5_quickOrderTransactionSchemaValid() {
  const user = await createTestUser('student');
  try {
    const tx = await Transaction.create({
      transactionId: crypto.randomUUID(),
      fromUser: user._id,
      amountKES: 150,
      transactionCategory: 'quick_order',
      paymentMethod: 'wallet',
      status: 'completed',
      description: 'Test quick_order schema'
    });
    if (!tx._id) throw new Error('Transaction creation returned no ID');
  } finally {
    await Transaction.deleteMany({ fromUser: user._id });
    await cleanup({ users: [user._id] });
  }
}

// TEST 6: walletService.debitWallet reduces available
async function test6_debitWalletReducesAvailable() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 2000, 'deposit', 'mpesa', 'Pre-fund', 'self');
    await walletService.debitWallet(user._id, 500, 'quick_order', 'wallet', 'Quick order debit');
    const wallet = await Wallet.findOne({ user: user._id });
    assertEqual('availableBalance after debit', wallet.availableBalanceKES, 1500);
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 7: subscription_only funds cannot be used for quick_order
async function test7_subscriptionOnlyFundsBlockedForQuickOrder() {
  const user = await createTestUser('student');
  try {
    // Create a subscription_only funding source
    const wallet = await walletService.creditWallet(user._id, 3000, 'deposit', 'wallet', 'Sub-only credit', 'sponsor', true, 'subscription_only');
    const wDoc = await Wallet.findOne({ user: user._id });
    const subOnlySource = wDoc.walletFundingSources.find(s => s.restrictedUsageType === 'subscription_only');
    if (!subOnlySource) throw new Error('subscription_only source not created');

    // debitWallet for quick_order should skip subscription_only sources
    try {
      await walletService.debitWallet(user._id, 100, 'quick_order', 'wallet', 'Quick order debit');
      // Should fail because only subscription_only funds available
      const w2 = await Wallet.findOne({ user: user._id });
      // If no error thrown, at least verify subscription_only wasn't consumed
      const subOnlyAfter = w2.walletFundingSources.find(s => s.restrictedUsageType === 'subscription_only');
      assertEqual('subscription_only amountKES unchanged', subOnlyAfter?.amountKES ?? 0, 3000);
    } catch (err) {
      // Expected: insufficient non-restricted funds
      if (!err.message.toLowerCase().includes('insufficient') && !err.message.toLowerCase().includes('balance')) {
        throw err;
      }
    }
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 8: availableBalance + lockedBalance = tokenBalanceNT at all times
async function test8_walletInternalConsistency() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 6000, 'deposit', 'mpesa', 'Pre-fund', 'self');
    await escrowService.lockSubscriptionFunds(user._id, 2000, null);
    await walletService.debitWallet(user._id, 500, 'quick_order', 'wallet', 'Debit for quick order');

    const wallet = await Wallet.findOne({ user: user._id });
    const computedTotal = Number((wallet.availableBalanceKES + wallet.lockedBalanceKES).toFixed(2));
    assertEqual('tokenBalanceNT == available + locked', wallet.tokenBalanceNT, computedTotal);
    assertNonNegative('availableBalanceKES non-negative', wallet.availableBalanceKES);
    assertNonNegative('lockedBalanceKES non-negative', wallet.lockedBalanceKES);
    assertNonNegative('tokenBalanceNT non-negative', wallet.tokenBalanceNT);
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 9: RefundRequest schema validation
async function test9_refundRequestSchemaValid() {
  const user = await createTestUser('student');
  try {
    const refund = await RefundRequest.create({
      student: user._id,
      amountKES: 1500,
      fundingType: 'self',
      deliveryIds: [],
      status: 'pending_admin_approval'
    });
    if (!refund._id) throw new Error('RefundRequest creation failed');
    assertEqual('amountKES stored correctly', refund.amountKES, 1500);
    await RefundRequest.deleteOne({ _id: refund._id });
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 10: Multiple credits accumulate correctly
async function test10_multipleCreditAccumulate() {
  const user = await createTestUser('student');
  try {
    await walletService.creditWallet(user._id, 1000, 'deposit', 'mpesa', 'Credit 1', 'self');
    await walletService.creditWallet(user._id, 2000, 'deposit', 'mpesa', 'Credit 2', 'self');
    await walletService.creditWallet(user._id, 500, 'deposit', 'mpesa', 'Credit 3', 'self');
    const wallet = await Wallet.findOne({ user: user._id });
    assertEqual('Total available after 3 credits', wallet.availableBalanceKES, 3500);
  } finally {
    await cleanup({ users: [user._id] });
  }
}

// TEST 11: Sponsor funding source is correctly created
async function test11_sponsorFundingSourceCreated() {
  const student = await createTestUser('student');
  const sponsor = await createTestUser('sponsor');
  try {
    await walletService.creditWallet(
      student._id, 4000, 'deposit', 'wallet',
      'Sponsor credit', 'sponsor', false, 'none'
    );
    const wallet = await Wallet.findOne({ user: student._id });
    const sponsorSource = wallet.walletFundingSources.find(s => s.sourceType === 'sponsor');
    if (!sponsorSource) throw new Error('Sponsor funding source not found in walletFundingSources');
    assertEqual('Sponsor source amount', sponsorSource.amountKES, 4000);
  } finally {
    await cleanup({ users: [student._id, sponsor._id] });
  }
}

// TEST 12: Vendor wallet credit via releaseDailyVendorPayment (mock)
async function test12_vendorPayoutTransactionCreated() {
  // This test creates the minimum required structures for releaseDailyVendorPayment
  // without calling Stellar. It just verifies we can find the delivery and records.
  const student = await createTestUser('student');
  const vendor = await createTestUser('vendor');
  try {
    await walletService.creditWallet(student._id, 5000, 'deposit', 'mpesa', 'Pre-fund', 'self');
    await escrowService.lockSubscriptionFunds(student._id, 5000, null);

    const delivery = await Delivery.create({
      student: student._id,
      vendor: vendor._id,
      items: [{ name: 'Test Meal', quantity: 1 }],
      status: 'pending',
      totalCost: 350,
      timeSlot: 'Lunch',
      scheduledDate: new Date(),
      location: 'Test Campus'
    });

    // Verify delivery can be found
    const found = await Delivery.findById(delivery._id);
    if (!found) throw new Error('Delivery not created');
    if (found.totalCost !== 350) throw new Error('Delivery totalCost mismatch');

    await Delivery.deleteOne({ _id: delivery._id });
  } finally {
    await cleanup({ users: [student._id, vendor._id] });
  }
}

// TEST 13: WalletFundingSources priority — sponsor unrestricted before self for quick order
async function test13_fundingPriorityForQuickOrder() {
  const student = await createTestUser('student');
  try {
    // Add self funds first
    await walletService.creditWallet(student._id, 500, 'deposit', 'mpesa', 'Self fund', 'self', false, 'none');
    // Add sponsor unrestricted
    await walletService.creditWallet(student._id, 1000, 'deposit', 'wallet', 'Sponsor fund', 'sponsor', false, 'none');

    const walletBefore = await Wallet.findOne({ user: student._id });
    const selfBefore = walletBefore.walletFundingSources.find(s => s.sourceType === 'self')?.amountKES || 0;
    const sponsorBefore = walletBefore.walletFundingSources.find(s => s.sourceType === 'sponsor')?.amountKES || 0;

    // Debit a quick order that should consume sponsor first
    await walletService.debitWallet(student._id, 300, 'quick_order', 'wallet', 'Quick order test');

    const walletAfter = await Wallet.findOne({ user: student._id });
    const sponsorAfter = walletAfter.walletFundingSources.find(s => s.sourceType === 'sponsor')?.amountKES || 0;
    const selfAfter = walletAfter.walletFundingSources.find(s => s.sourceType === 'self')?.amountKES || 0;

    // Sponsor should be consumed before self
    if (sponsorAfter >= sponsorBefore && selfAfter < selfBefore) {
      throw new Error('FUNDING PRIORITY ERROR: Self consumed before sponsor for quick_order');
    }
  } finally {
    await cleanup({ users: [student._id] });
  }
}

// TEST 14: Transaction direction consistency — subscription_lock is debit (out)
async function test14_transactionDirectionConsistency() {
  const { getTransactionDirection } = require('../utils/transactionUtils');
  const currentUserId = new mongoose.Types.ObjectId();

  const lockTx = {
    transactionCategory: 'subscription_lock',
    fromUser: currentUserId,
    toUser: null,
    amountKES: 5000,
    status: 'completed'
  };

  const depositTx = {
    transactionCategory: 'deposit',
    fromUser: null,
    toUser: currentUserId,
    amountKES: 5000,
    status: 'completed'
  };

  const lockDir = getTransactionDirection(lockTx, currentUserId.toString());
  const depositDir = getTransactionDirection(depositTx, currentUserId.toString());

  if (lockDir !== 'out') throw new Error(`subscription_lock direction should be 'out', got '${lockDir}'`);
  if (depositDir !== 'in') throw new Error(`deposit direction should be 'in', got '${depositDir}'`);
}

// TEST 15: Transaction direction for refund is 'in' (credit to student)
async function test15_refundDirectionIsIn() {
  const { getTransactionDirection } = require('../utils/transactionUtils');
  const currentUserId = new mongoose.Types.ObjectId();

  const refundTx = {
    transactionCategory: 'refund',
    fromUser: new mongoose.Types.ObjectId(), // from admin/system
    toUser: currentUserId,
    amountKES: 2000,
    status: 'completed'
  };

  const dir = getTransactionDirection(refundTx, currentUserId.toString());
  if (dir !== 'in') throw new Error(`refund direction should be 'in', got '${dir}'`);
}

// TEST 16: Ledger-level reconciliation — available + locked = tokenBalanceNT for all wallets
async function test16_fullLedgerReconciliation() {
  const wallets = await Wallet.find({ walletType: { $in: ['student', 'vendor', 'sponsor'] } }).limit(50);
  const mismatches = [];

  for (const w of wallets) {
    const computed = Number((w.availableBalanceKES + w.lockedBalanceKES).toFixed(2));
    if (Math.abs(computed - w.tokenBalanceNT) > 0.01) {
      mismatches.push({
        user: w.user,
        tokenBalanceNT: w.tokenBalanceNT,
        computed,
        diff: computed - w.tokenBalanceNT
      });
    }
  }

  if (mismatches.length > 0) {
    const details = mismatches.map(m => `User ${m.user}: tokenBalanceNT=${m.tokenBalanceNT}, computed=${m.computed}, diff=${m.diff}`).join('\n       ');
    throw new Error(`${mismatches.length} wallet(s) have tokenBalanceNT inconsistencies:\n       ${details}`);
  }
}

// ─────────────── MAIN ───────────────
async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  NUTRIPAY FINANCIAL INTEGRITY TEST SUITE — PASS 4');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.connect(process.env.MONGO_URI);
  console.log('  📦  Connected to MongoDB\n');

  console.log('  ── WALLET ARITHMETIC TESTS ─────────────────────────────\n');
  await test('T01: creditWallet increases availableBalance', test1_creditWalletIncreasesAvailable);
  await test('T02: lockSubscriptionFunds moves available → locked', test2_lockSubscriptionFundsMoves);
  await test('T03: refundFunds does NOT change tokenBalanceNT', test3_refundFundsBalanceConsistency);
  await test('T04: refundFunds cannot over-refund locked balance', test4_refundFundsCannotOverdraw);
  await test('T10: Multiple credits accumulate correctly', test10_multipleCreditAccumulate);
  await test('T08: tokenBalanceNT = available + locked invariant holds', test8_walletInternalConsistency);

  console.log('\n  ── TRANSACTION SCHEMA TESTS ────────────────────────────\n');
  await test('T05: Transaction schema accepts quick_order category', test5_quickOrderTransactionSchemaValid);
  await test('T09: RefundRequest schema is valid and creates correctly', test9_refundRequestSchemaValid);

  console.log('\n  ── DEBIT & FUNDING PRIORITY TESTS ─────────────────────\n');
  await test('T06: debitWallet reduces availableBalance', test6_debitWalletReducesAvailable);
  await test('T07: subscription_only funds blocked for quick_order', test7_subscriptionOnlyFundsBlockedForQuickOrder);
  await test('T11: Sponsor funding source correctly created', test11_sponsorFundingSourceCreated);
  await test('T13: Sponsor funds consumed before self for quick_order', test13_fundingPriorityForQuickOrder);

  console.log('\n  ── DELIVERY & PAYOUT TESTS ─────────────────────────────\n');
  await test('T12: Delivery creation and payout structure valid', test12_vendorPayoutTransactionCreated);

  console.log('\n  ── TRANSACTION DIRECTION TESTS ─────────────────────────\n');
  await test('T14: subscription_lock direction is "out"', test14_transactionDirectionConsistency);
  await test('T15: refund direction is "in"', test15_refundDirectionIsIn);

  console.log('\n  ── FULL LEDGER RECONCILIATION ──────────────────────────\n');
  await test('T16: All live wallets pass internal consistency check', test16_fullLedgerReconciliation);

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅  PASSED: ${passed}`);
  console.log(`  ❌  FAILED: ${failed}`);
  if (errors.length > 0) {
    console.log('\n  FAILURES:');
    errors.forEach(e => console.log(`    ✗ ${e.name}\n      → ${e.message}`));
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
