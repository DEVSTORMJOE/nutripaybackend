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
  }

  // Create locking transaction
  const tx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: funderId,
    toUser: studentId,
    amountKES: amountKes,
    transactionCategory: 'subscription_lock',
    paymentMethod: 'wallet',
    paymentSource: sponsorId ? 'sponsor_funds' : 'student_wallet',
    orderType: 'subscription',
    stellarTxHash: stellarTxHash || null,
    status: 'completed',
    settlementStatus: settlementStatus,
    description: `Subscription lock of ${amountKes} KES for student`
  }], { session });

  return { studentWallet, transaction: tx[0] };
}

/**
 * Release proportional daily payout for completed delivery: Escrow -> Vendor and Escrow -> Revenue on Stellar (NT)
 */
async function releaseDailyVendorPayment(deliveryId, session = null) {
  const delivery = await Delivery.findById(deliveryId).session(session);
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.status === 'delivered') return { alreadyReleased: true };

  const totalCost = Number(delivery.totalCost || 0);
  if (totalCost <= 0) return { freeOrder: true };

  const vendorProfile = await Vendor.findById(delivery.vendor).session(session);
  if (!vendorProfile) throw new Error("Vendor profile not found");

  // Calculate split based on dynamic vendor commission settings
  const vendorCommission = vendorProfile.vendorCommissionPercent !== undefined ? vendorProfile.vendorCommissionPercent : 90;
  const platformCommission = vendorProfile.platformCommissionPercent !== undefined ? vendorProfile.platformCommissionPercent : 10;
  const commissionRate = platformCommission / 100;

  const commission = Number((totalCost * commissionRate).toFixed(2));
  const vendorShare = Number((totalCost - commission).toFixed(2));

  console.log(`[Escrow Service] Releasing daily payout for Delivery: ${deliveryId}. Cost: ${totalCost} KES. Vendor Share: ${vendorShare}, Commission: ${commission}`);

  // 1. Lock/Release checks on Student
  const studentWallet = await Wallet.findOne({ user: delivery.student }).session(session);
  if (!studentWallet || studentWallet.lockedBalanceKES < totalCost) {
    throw new Error(`Student locked balance is insufficient to cover delivery cost of ${totalCost}`);
  }

  studentWallet.lockedBalanceKES = Number((studentWallet.lockedBalanceKES - totalCost).toFixed(2));
  await studentWallet.save({ session });

  // 2. Credit Vendor wallet available balance and funding sources
  const vendorWallet = await walletService.creditWallet(
    vendorProfile.user,
    vendorShare,
    'vendor_payout',
    'stellar',
    `Payout for delivery ${deliveryId}`,
    'self',
    false,
    'none',
    session
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
  }

  try {
    // Escrow -> Revenue
    stellarTxHash2 = await stellarTreasuryService.recordRevenue(commission);
    settlementStatus2 = "synced";
  } catch (err) {
    console.error("Stellar delivery escrow commission to Revenue failed. Marked failed for retry:", err.message);
    settlementStatus2 = "failed";
  }

  // 4. Log Transactions in MongoDB
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
  }], { session });

  const commissionTx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: delivery.student,
    amountKES: commission,
    transactionCategory: 'commission',
    paymentMethod: 'stellar',
    orderType: 'subscription',
    stellarTxHash: stellarTxHash2 || null,
    status: 'completed',
    settlementStatus: settlementStatus2,
    description: `Platform commission for delivery ${deliveryId}`
  }], { session });

  return { studentWallet, vendorWallet: vendorWallet.wallet, transactions: [vendorTx[0], commissionTx[0]] };
}

/**
 * Refund undelivered/cancelled subscription meals from Escrow -> Treasury on Stellar (NT), and credit KES locally
 */
async function calculateRefund(deliveryIds, studentId, session = null) {
  const deliveries = await Delivery.find({
    _id: { $in: deliveryIds },
    status: { $in: ['pending', 'assigned', 'preparing', 'ready', 'cancelled'] },
    student: studentId
  }).session(session);
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

  const totalRefundKes = totalRefundToSponsor + totalRefundToStudent;
  if (totalRefundKes <= 0) return { refundedKES: 0 };

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
    const studentWallet = await Wallet.findOne({ user: studentId }).session(session);
    if (!studentWallet || studentWallet.lockedBalanceKES < totalRefundToSponsor) {
      throw new Error("Student locked balance is insufficient to process sponsor refund portion");
    }
    studentWallet.lockedBalanceKES = Number((studentWallet.lockedBalanceKES - totalRefundToSponsor).toFixed(2));
    await studentWallet.save({ session });

    // Credit sponsor's available balance (sponsor wallet has no locked funds)
    await walletService.creditWallet(
      sponsorId,
      totalRefundToSponsor,
      'refund',
      'wallet',
      `Refund for opted-out student pending deliveries`,
      'sponsor',
      false,
      'none',
      session
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
  }

  // Record refund transaction log
  await Transaction.create([{
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
  }], { session });

  // Update delivery statuses to cancelled
  await Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'cancelled' } }).session(session);

  return { refundedKES: totalRefundKes, stellarTxHash };
}

module.exports = {
  lockSubscriptionFunds,
  releaseDailyVendorPayment,
  calculateRefund
};
