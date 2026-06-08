const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const walletService = require('./walletService');
const stellarTreasuryService = require('./stellarTreasuryService');
const crypto = require('crypto');

/**
 * Lock subscription funds: move KES from available to locked, and settle Treasury -> Escrow on Stellar (NT)
 */
async function lockSubscriptionFunds(studentId, amountKes, sponsorId = null, session = null) {
  const funderId = sponsorId || studentId;
  const sourceType = sponsorId ? 'sponsor' : 'self';

  console.log(`[Escrow Service] Locking subscription funds of ${amountKes} KES for student ${studentId}. Sponsor: ${sponsorId || 'none'}`);

  // Lock locally (deducts from available buckets, credits locked balance, saves, and updates tokenBalanceNT)
  const studentWallet = await walletService.lockFunds(studentId, amountKes, session);

  // Settle on-chain (Treasury -> Escrow in NT)
  let stellarTxHash = "";
  let settlementStatus = "pending";
  try {
    stellarTxHash = await stellarTreasuryService.settleToEscrow(amountKes);
    settlementStatus = "synced";
  } catch (err) {
    console.error("Critical Stellar escrow lock failed. Logged locally, marked failed for retry queue:", err.message);
    settlementStatus = "failed";
    const errorLogger = require('../utils/errorLogger');
    await errorLogger.logError('escrow', `Stellar escrow lock failed for student subscription funding. KES: ${amountKes}`, {
      studentId,
      amountKES: amountKes,
      error: err.message
    }, 'error');
  }

  // Create subscription lock transaction for user & admin audit trail
  const txOpts = session ? { session } : {};
  const lockTx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: studentId,
    toUser: null,
    amountKES: Number(amountKes),
    transactionCategory: 'subscription_lock',
    paymentMethod: 'wallet',
    paymentSource: sponsorId ? 'sponsor_funds' : 'student_wallet',
    orderType: 'subscription',
    stellarTxHash: stellarTxHash || null,
    status: 'completed',
    settlementStatus: settlementStatus,
    description: 'Meal Plan Subscription Processed'
  }], txOpts);

  return { studentWallet, transaction: lockTx[0] };
}

/**
 * Release proportional daily payout for completed delivery: Escrow -> Vendor and Escrow -> Revenue on Stellar (NT)
 */
async function releaseDailyVendorPayment(deliveryId, session = null) {
  const delivery = session
    ? await Delivery.findById(deliveryId).session(session)
    : await Delivery.findById(deliveryId);
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.status === 'delivered') return { alreadyReleased: true };

  const totalCost = Number(delivery.totalCost || 0);
  if (totalCost <= 0) return { freeOrder: true };

  const vendorProfile = session
    ? await Vendor.findById(delivery.vendor).session(session)
    : await Vendor.findById(delivery.vendor);
  if (!vendorProfile) throw new Error("Vendor profile not found");

  // Calculate split based on dynamic vendor commission settings
  const vendorCommission = vendorProfile.vendorCommissionPercent !== undefined ? vendorProfile.vendorCommissionPercent : 90;
  const platformCommission = vendorProfile.platformCommissionPercent !== undefined ? vendorProfile.platformCommissionPercent : 10;
  const commissionRate = platformCommission / 100;

  const commission = Number((totalCost * commissionRate).toFixed(2));
  const vendorShare = Number((totalCost - commission).toFixed(2));

  console.log(`[Escrow Service] Releasing daily payout for Delivery: ${deliveryId}. Cost: ${totalCost} KES. Vendor Share: ${vendorShare}, Commission: ${commission}`);

  // 1. Lock/Release checks on Student
  const studentWallet = session
    ? await Wallet.findOne({ user: delivery.student }).session(session)
    : await Wallet.findOne({ user: delivery.student });
  if (!studentWallet || studentWallet.lockedBalanceKES < totalCost) {
    throw new Error(`Student locked balance is insufficient to cover delivery cost of ${totalCost}`);
  }

  studentWallet.lockedBalanceKES = Number((studentWallet.lockedBalanceKES - totalCost).toFixed(2));
  await studentWallet.save(session ? { session } : {});

  // 2. Credit Vendor wallet available balance and funding sources
  // skipTxLog=true: escrowService already creates its own Transaction below (escrow_release).
  // Passing false here would create a duplicate 'vendor_payout' transaction for the same payout.
  const vendorWallet = await walletService.creditWallet(
    vendorProfile.user,
    vendorShare,
    'vendor_payout',
    'stellar',
    `Payout for delivery ${deliveryId}`,
    'self',
    false,
    'none',
    session,
    true  // skipTxLog — transaction logged below as 'escrow_release'
  );

  // 3. Perform on-chain settlements (NT Token transfers)
  let stellarTxHash1 = "";
  let stellarTxHash2 = "";
  let settlementStatus1 = "pending";
  let settlementStatus2 = "pending";

  try {
    // Escrow -> Vendor Settlement
    stellarTxHash1 = await stellarTreasuryService.releaseVendorSettlement(vendorShare);
    settlementStatus1 = "synced";
  } catch (err) {
    console.error("Stellar delivery escrow release to Vendor failed. Marked failed for retry:", err.message);
    settlementStatus1 = "failed";
    const errorLogger = require('../utils/errorLogger');
    await errorLogger.logError('escrow', `Stellar delivery escrow release to Vendor failed for delivery ${deliveryId}. KES: ${vendorShare}`, {
      deliveryId,
      vendorShare,
      error: err.message
    }, 'error');
  }

  try {
    // Escrow -> Revenue
    stellarTxHash2 = await stellarTreasuryService.recordRevenue(commission);
    settlementStatus2 = "synced";
  } catch (err) {
    console.error("Stellar delivery escrow commission to Revenue failed. Marked failed for retry:", err.message);
    settlementStatus2 = "failed";
    const errorLogger = require('../utils/errorLogger');
    await errorLogger.logError('escrow', `Stellar delivery escrow commission to Revenue failed for delivery ${deliveryId}. KES: ${commission}`, {
      deliveryId,
      commission,
      error: err.message
    }, 'error');
  }

  // 4. Log Transactions in MongoDB
  const txOpts = session ? { session } : {};
  const vendorTx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: delivery.student,
    toUser: vendorProfile.user,
    amountKES: vendorShare,
    transactionCategory: 'escrow_release',
    paymentMethod: 'stellar',
    orderType: 'subscription',
    stellarTxHash: stellarTxHash1 || null,
    status: 'completed',
    settlementStatus: settlementStatus1,
    description: `Payout for delivery ${deliveryId}`
  }], txOpts);

  const commissionTx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: vendorProfile.user, // Vendor pays commission!
    toUser: null, // to Platform/System
    amountKES: commission,
    transactionCategory: 'commission',
    paymentMethod: 'stellar',
    orderType: 'subscription',
    stellarTxHash: stellarTxHash2 || null,
    status: 'completed',
    settlementStatus: settlementStatus2,
    description: `Platform commission (${platformCommission}%) for delivery ${deliveryId}`
  }], txOpts);

  // Credit admin wallet for the commission
  const Wallet = require('../models/Wallet');
  await Wallet.updateOne(
    { walletType: 'admin' },
    { $inc: { availableBalanceKES: Number(commission.toFixed(2)) } },
    txOpts
  );

  return { studentWallet, vendorWallet: vendorWallet.wallet, transactions: [vendorTx[0], commissionTx[0]] };
}

/**
 * Refund undelivered/cancelled subscription meals from Escrow -> Treasury on Stellar (NT), and credit KES locally
 */
async function calculateRefund(deliveryIds, studentId, session = null) {
  // CRITICAL: Only include deliveries that have NOT been delivered.
  // Delivered meals have already been paid to vendors — their cost has been
  // released from lockedBalanceKES via releaseDailyVendorPayment.
  // Refunding them would double-count money that no longer exists in escrow.
  const deliveries = session
    ? await Delivery.find({
        _id: { $in: deliveryIds },
        status: { $in: ['pending', 'assigned', 'preparing', 'ready', 'cancelled'] },
        student: studentId
      }).session(session)
    : await Delivery.find({
        _id: { $in: deliveryIds },
        status: { $in: ['pending', 'assigned', 'preparing', 'ready', 'cancelled'] },
        student: studentId
      });
  if (deliveries.length === 0) return { refundedKES: 0 };

  let totalRefundToSponsor = 0;
  let totalRefundToStudent = 0;
  let sponsorId = null;

  deliveries.forEach(d => {
    if (d.sponsor) {
      totalRefundToSponsor += Number(d.totalCost || 0);
      sponsorId = d.sponsor;
    } else {
      totalRefundToStudent += Number(d.totalCost || 0);
    }
  });

  // Get student's wallet to check current locked balance
  const studentWallet = session
    ? await Wallet.findOne({ user: studentId }).session(session)
    : await Wallet.findOne({ user: studentId });
  let currentLocked = studentWallet ? studentWallet.lockedBalanceKES : 0;
  let remainingLocked = currentLocked;

  // Cap student portion first
  if (totalRefundToStudent > remainingLocked) {
    console.log(`[Escrow Service Capping] Student portion ${totalRefundToStudent} KES exceeds lockedBalanceKES ${remainingLocked} KES. Capping student portion.`);
    totalRefundToStudent = remainingLocked;
  }
  remainingLocked = Number((remainingLocked - totalRefundToStudent).toFixed(2));

  // Cap sponsor portion next
  if (totalRefundToSponsor > remainingLocked) {
    console.log(`[Escrow Service Capping] Sponsor portion ${totalRefundToSponsor} KES exceeds remaining locked balance ${remainingLocked} KES. Capping sponsor portion.`);
    totalRefundToSponsor = remainingLocked;
  }

  const totalRefundKes = Number((totalRefundToSponsor + totalRefundToStudent).toFixed(2));

  console.log(`[Escrow Service] Subscription refund for student ${studentId}. Total: ${totalRefundKes} KES. Sponsor Portion: ${totalRefundToSponsor}, Student Portion: ${totalRefundToStudent}`);

  // Deduct from student lockedBalanceKES and credit availableBalanceKES
  // For self-funded portion: refund goes to student wallet via refundFunds()
  // For sponsor-funded portion: deduct from student locked, credit sponsor wallet
  if (totalRefundToStudent > 0) {
    // walletService.refundFunds now correctly: locked -= amount, available += amount
    await walletService.refundFunds(studentId, totalRefundToStudent, 'refund', 'self', session);
  }

  // For sponsor-funded portion: deduct locked from student, credit sponsor's available
  if (totalRefundToSponsor > 0 && sponsorId) {
    // Manually deduct from student lockedBalanceKES (sponsor portion)
    if (studentWallet) {
      studentWallet.lockedBalanceKES = Number((studentWallet.lockedBalanceKES - totalRefundToSponsor).toFixed(2));
      if (session) {
        await studentWallet.save({ session });
      } else {
        await studentWallet.save();
      }
    }

    // Credit sponsor's available balance (sponsor wallet has no locked funds)
    // skipTxLog=true: the refund Transaction is logged below as 'refund' category.
    await walletService.creditWallet(
      sponsorId,
      totalRefundToSponsor,
      'refund',
      'wallet',
      `Refund for opted-out student pending deliveries`,
      'sponsor',
      false,
      'none',
      session,
      true  // skipTxLog — transaction logged below
    );
  }

  // Stellar Settlement: Escrow -> Treasury (reversing locked funds on-chain using NT token)
  let stellarTxHash = "";
  let settlementStatus = "pending";
  try {
    stellarTxHash = await stellarTreasuryService.reverseSettlement(totalRefundKes);
    settlementStatus = "synced";
  } catch (err) {
    console.error("Stellar refund reverse settlement failed. Marked failed for retry queue:", err.message);
    settlementStatus = "failed";
    const errorLogger = require('../utils/errorLogger');
    await errorLogger.logError('escrow', `Stellar reverse settlement failed for refund. KES: ${totalRefundKes}`, {
      studentId,
      totalRefundKes,
      error: err.message
    }, 'error');
  }

  // Record refund transaction log
  const txDocs = [{
    transactionId: crypto.randomUUID(),
    fromUser: studentId,
    toUser: sponsorId || studentId,
    amountKES: totalRefundKes,
    transactionCategory: 'refund',
    paymentMethod: 'wallet',
    status: 'completed',
    settlementStatus: settlementStatus,
    stellarTxHash: stellarTxHash || null,
    description: `Refund for cancelled/opt-out deliveries`
  }];
  if (session) {
    await Transaction.create(txDocs, { session });
  } else {
    await Transaction.create(txDocs);
  }

  // Update delivery statuses to cancelled
  const updateQuery = Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'cancelled' } });
  await (session ? updateQuery.session(session) : updateQuery);

  return { refundedKES: totalRefundKes, stellarTxHash };
}

/**
 * Refund the price difference when changing to a lower budget meal
 */
async function refundMealPriceDifference(delivery, newPrice, session = null) {
  if (!delivery) throw new Error("Delivery object is required");

  const originalCost = Number(delivery.totalCost || 0);
  const diff = Number((originalCost - newPrice).toFixed(2));
  if (diff <= 0) return { refunded: 0 };

  const studentId = delivery.student;
  const sponsorId = delivery.sponsor || null;

  // Get student's wallet to check current locked balance
  const studentWallet = session
    ? await Wallet.findOne({ user: studentId }).session(session)
    : await Wallet.findOne({ user: studentId });
  if (!studentWallet || studentWallet.lockedBalanceKES < diff) {
    console.warn(`[Escrow Service] Student locked balance ${studentWallet?.lockedBalanceKES} is less than refund diff ${diff}. Capping refund.`);
  }

  const actualRefund = studentWallet ? Math.min(diff, studentWallet.lockedBalanceKES) : 0;
  if (actualRefund <= 0) return { refunded: 0 };

  if (sponsorId) {
    // Deduct locked from student
    studentWallet.lockedBalanceKES = Number((studentWallet.lockedBalanceKES - actualRefund).toFixed(2));
    await studentWallet.save(session ? { session } : {});

    // Credit sponsor
    // skipTxLog=true: Transaction is logged below as 'refund'
    await walletService.creditWallet(
      sponsorId,
      actualRefund,
      'refund',
      'wallet',
      `Refund for lower budget meal change difference`,
      'sponsor',
      false,
      'none',
      session,
      true  // skipTxLog
    );
  } else {
    // Self-funded: refund to student available balance
    await walletService.refundFunds(studentId, actualRefund, 'refund', 'self', session);
  }

  // Stellar settlement: Escrow -> Treasury (reverse locked funds)
  let stellarTxHash = "";
  let settlementStatus = "pending";
  try {
    stellarTxHash = await stellarTreasuryService.reverseSettlement(actualRefund);
    settlementStatus = "synced";
  } catch (err) {
    console.error("Stellar price diff refund reverse settlement failed. Marked failed for retry:", err.message);
    settlementStatus = "failed";
    const errorLogger = require('../utils/errorLogger');
    await errorLogger.logError('escrow', `Stellar price difference refund reverse settlement failed. KES: ${actualRefund}`, {
      deliveryId: delivery._id,
      studentId,
      actualRefund,
      error: err.message
    }, 'error');
  }

  // Record transaction log
  const priceDiffTxOpts = session ? { session } : {};
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: studentId,
    toUser: sponsorId || studentId,
    amountKES: actualRefund,
    transactionCategory: 'refund',
    paymentMethod: 'wallet',
    status: 'completed',
    settlementStatus: settlementStatus,
    stellarTxHash: stellarTxHash || null,
    description: `Refund for changing to a lower budget meal (${delivery.items?.[0]?.name || 'Meal'} -> ${newPrice} KES)`
  }], priceDiffTxOpts);

  // Update delivery cost
  delivery.totalCost = newPrice;
  await delivery.save(session ? { session } : {});

  return { refunded: actualRefund, stellarTxHash };
}

/**
 * Charge the price difference when changing to a higher budget meal
 */
async function chargeMealPriceDifference(delivery, newPrice, session = null) {
  if (!delivery) throw new Error("Delivery object is required");

  const originalCost = Number(delivery.totalCost || 0);
  const diff = Number((newPrice - originalCost).toFixed(2));
  if (diff <= 0) return { charged: 0 };

  const studentId = delivery.student;

  // Get student's wallet strictly
  const studentWallet = session
    ? await Wallet.findOne({ user: studentId }).session(session)
    : await Wallet.findOne({ user: studentId });
  if (!studentWallet || studentWallet.availableBalanceKES < diff) {
    throw new Error(`Insufficient student wallet available balance. You need KES ${diff} to cover the price difference.`);
  }

  // Deduct from available balance and credit locked balance
  studentWallet.availableBalanceKES = Number((studentWallet.availableBalanceKES - diff).toFixed(2));
  studentWallet.lockedBalanceKES = Number((studentWallet.lockedBalanceKES + diff).toFixed(2));
  await studentWallet.save(session ? { session } : {});

  // Stellar settlement: Escrow -> Treasury (lock additional funds on-chain using NT token)
  let stellarTxHash = "";
  let settlementStatus = "pending";
  try {
    stellarTxHash = await stellarTreasuryService.settleToEscrow(diff);
    settlementStatus = "synced";
  } catch (err) {
    console.error("Stellar price diff lock settlement failed. Marked failed for retry:", err.message);
    settlementStatus = "failed";
    const errorLogger = require('../utils/errorLogger');
    await errorLogger.logError('escrow', `Stellar price difference lock settlement failed. KES: ${diff}`, {
      deliveryId: delivery._id,
      studentId,
      diff,
      error: err.message
    }, 'error');
  }

  // Record transaction log
  const chargeTxOpts = session ? { session } : {};
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: studentId,
    toUser: studentId,
    amountKES: diff,
    transactionCategory: 'subscription_lock',
    paymentMethod: 'wallet',
    status: 'completed',
    settlementStatus: settlementStatus,
    stellarTxHash: stellarTxHash || null,
    description: `Charge for changing to a higher budget meal (${delivery.items?.[0]?.name || 'Meal'} -> ${newPrice} KES)`
  }], chargeTxOpts);

  // Update delivery cost
  delivery.totalCost = newPrice;
  await delivery.save(session ? { session } : {});

  return { charged: diff, stellarTxHash };
}

module.exports = {
  lockSubscriptionFunds,
  releaseDailyVendorPayment,
  calculateRefund,
  refundMealPriceDifference,
  chargeMealPriceDifference
};

