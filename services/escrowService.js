const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const walletService = require('./walletService');
const stellarTreasuryService = require('./stellarTreasuryService');
const crypto = require('crypto');

/**
 * Lock subscription funds: move KES from available to locked, and settle Treasury -> Escrow on Stellar
 */
async function lockSubscriptionFunds(studentId, amountKes, sponsorId = null, session = null) {
  const funderId = sponsorId || studentId;

  console.log(`[Escrow Service] Locking subscription funds of ${amountKes} KES for student ${studentId}. Sponsor: ${sponsorId || 'none'}`);

  // Lock locally
  const studentWallet = await walletService.getOrCreateWallet(studentId, 'student', session);

  if (studentWallet.availableBalanceKES < amountKes) {
    throw new Error("Insufficient available balance in student wallet to fund subscription");
  }

  // Deduct from available spendable pool and add to protected locked balance
  studentWallet.availableBalanceKES -= Number(amountKes);
  studentWallet.totalSpentKES += Number(amountKes);
  studentWallet.lockedBalanceKES += Number(amountKes);

  await studentWallet.save({ session });

  // Settle on-chain (Treasury -> Escrow)
  let stellarTxHash = "";
  try {
    stellarTxHash = await stellarTreasuryService.settleToEscrow(amountKes);
  } catch (err) {
    console.error("Critical Stellar escrow lock failed. Mirroring internally but flagging on-chain delay:", err.message);
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
    description: `Subscription lock of ${amountKes} KES for student`
  }], { session });

  return { studentWallet, transaction: tx[0] };
}

/**
 * Release proportional daily payout for completed delivery: Escrow -> Vendor and Escrow -> Revenue
 */
async function releaseDailyVendorPayment(deliveryId, session = null) {
  const delivery = await Delivery.findById(deliveryId).session(session);
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.status === 'delivered') return { alreadyReleased: true };

  const totalCost = Number(delivery.totalCost || 0);
  if (totalCost <= 0) return { freeOrder: true };

  // Calculate split: 90% Vendor, 10% Platform Commission
  const commission = Number((totalCost * 0.10).toFixed(2));
  const vendorShare = Number((totalCost - commission).toFixed(2));

  console.log(`[Escrow Service] Releasing daily payout for Delivery: ${deliveryId}. Cost: ${totalCost} KES. Vendor Share: ${vendorShare}, Commission: ${commission}`);

  // 1. Lock/Release checks on Student
  const studentWallet = await Wallet.findOne({ user: delivery.student }).session(session);
  if (!studentWallet || studentWallet.lockedBalanceKES < totalCost) {
    throw new Error(`Student locked balance is insufficient to cover delivery cost of ${totalCost}`);
  }

  studentWallet.lockedBalanceKES -= totalCost;
  await studentWallet.save({ session });

  // 2. Credit Vendor wallet
  // In the Delivery schema, delivery.vendor is a ref to the Vendor model. We need to find the User linked to Vendor.
  const vendorProfile = await Vendor.findById(delivery.vendor).session(session);
  if (!vendorProfile) throw new Error("Vendor profile not found");
  
  const vendorWallet = await walletService.getOrCreateWallet(vendorProfile.user, 'vendor', session);
  vendorWallet.availableBalanceKES += vendorShare;
  await vendorWallet.save({ session });

  // 3. Perform on-chain settlements
  let stellarTxHash1 = "";
  let stellarTxHash2 = "";
  try {
    // Escrow -> Vendor Settlement
    stellarTxHash1 = await stellarTreasuryService.releaseVendorSettlement(vendorShare);
    // Escrow -> Revenue
    stellarTxHash2 = await stellarTreasuryService.recordRevenue(commission);
  } catch (err) {
    console.error("Critical Stellar delivery settlement failed. Processing local balances but flagging on-chain delay:", err.message);
  }

  // 4. Log Transactions
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
    description: `Platform commission for delivery ${deliveryId}`
  }], { session });

  return { studentWallet, vendorWallet, transactions: [vendorTx[0], commissionTx[0]] };
}

/**
 * Refund undelivered/cancelled subscription meals from Escrow -> Treasury on Stellar, and credit KES locally
 */
async function calculateRefund(deliveryIds, studentId, session = null) {
  const deliveries = await Delivery.find({ _id: { $in: deliveryIds }, status: 'pending', student: studentId }).session(session);
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

  // Deduct student locked balance
  const studentWallet = await Wallet.findOne({ user: studentId }).session(session);
  if (!studentWallet || studentWallet.lockedBalanceKES < totalRefundKes) {
    throw new Error("Student locked balance is insufficient to process this refund");
  }
  studentWallet.lockedBalanceKES -= totalRefundKes;
  await studentWallet.save({ session });

  // Credit funder available balance
  if (totalRefundToSponsor > 0 && sponsorId) {
    const sponsorWallet = await walletService.getOrCreateWallet(sponsorId, 'sponsor', session);
    sponsorWallet.availableBalanceKES += totalRefundToSponsor;
    sponsorWallet.totalRefundedKES += totalRefundToSponsor;
    await sponsorWallet.save({ session });

    await Transaction.create([{
      transactionId: crypto.randomUUID(),
      toUser: sponsorId,
      amountKES: totalRefundToSponsor,
      transactionCategory: 'refund',
      paymentMethod: 'wallet',
      status: 'completed',
      description: `Refund for opted-out student pending deliveries`
    }], { session });
  }

  if (totalRefundToStudent > 0) {
    studentWallet.availableBalanceKES += totalRefundToStudent;
    studentWallet.totalRefundedKES += totalRefundToStudent;
    await studentWallet.save({ session });

    await Transaction.create([{
      transactionId: crypto.randomUUID(),
      toUser: studentId,
      amountKES: totalRefundToStudent,
      transactionCategory: 'refund',
      paymentMethod: 'wallet',
      status: 'completed',
      description: `Refund for cancelled deliveries`
    }], { session });
  }

  // Stellar Settlement: Escrow -> Treasury (reversing locked funds)
  let stellarTxHash = "";
  try {
    stellarTxHash = await stellarTreasuryService.reverseSettlement(totalRefundKes);
  } catch (err) {
    console.error("Stellar refund reverse settlement failed. Processing locally:", err.message);
  }

  // Update delivery statuses to cancelled
  await Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'cancelled' } }).session(session);

  return { refundedKES: totalRefundKes, stellarTxHash };
}

module.exports = {
  lockSubscriptionFunds,
  releaseDailyVendorPayment,
  calculateRefund
};
