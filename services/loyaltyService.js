const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const LoyaltyLog = require("../models/LoyaltyLog");
const Transaction = require("../models/Transaction");
const ledgerService = require("./ledgerService");
const stellarTreasuryService = require("./stellarTreasuryService");

/**
 * Calculate loyalty points earned based on order amount (in KES).
 * Rules:
 *  - 0 to 99 KES: 0 points
 *  - 100 to 199 KES: 1 point
 *  - 200 to 299 KES: 2 points
 *  - 300 to 399 KES: 3 points
 *  - 400 to 499 KES: 4 points
 *  - 500+ KES: 5 points (capped max)
 */
function calculatePoints(orderAmountKES) {
  const amount = Number(orderAmountKES) || 0;
  if (amount < 100) return 0;
  if (amount >= 500) return 5;
  return Math.floor(amount / 100);
}

const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");

/**
 * Flag an abnormal loyalty point event in AuditLog and dispatch Admin Notification
 */
async function flagLoyaltyAnomaly({ userId, orderId = null, pointsAttempted = 0, orderAmountKES = 0, reason = "" }) {
  try {
    const details = {
      userId: userId ? userId.toString() : null,
      orderId: orderId ? orderId.toString() : null,
      pointsAttempted,
      orderAmountKES,
      reason,
      timestamp: new Date().toISOString()
    };

    // Log to AuditLog
    await AuditLog.create({
      action: "loyalty_anomaly",
      user: userId || new mongoose.Types.ObjectId(),
      details
    });

    // Notify Admins
    const adminUsers = await User.find({ role: "admin" }).select("_id");
    for (const admin of adminUsers) {
      await Notification.create({
        user: admin._id,
        type: "alert",
        title: "Abnormal Loyalty Points Flagged",
        message: `Loyalty point anomaly detected for user ${userId || 'Unknown'}: ${reason}. Points: ${pointsAttempted}, Order KES: ${orderAmountKES}`
      });
    }

    console.warn(`[Loyalty Anomaly Engine] Flagged anomaly for user ${userId}: ${reason}`);
  } catch (err) {
    console.error("[Loyalty Anomaly Engine] Failed to record anomaly:", err.message);
  }
}

/**
 * Award loyalty points to a user for a completed order.
 * If user reaches 100+ points, automatically triggers threshold conversion to wallet & Stellar NT minting.
 */
async function awardPoints({ userId, orderId = null, orderAmountKES }) {
  let pointsEarned = calculatePoints(orderAmountKES);

  // Anomaly Check 1: points per single order capped at 5 points maximum
  if (pointsEarned > 5) {
    await flagLoyaltyAnomaly({
      userId,
      orderId,
      pointsAttempted: pointsEarned,
      orderAmountKES,
      reason: `Attempted to award ${pointsEarned} points (> max allowed 5 points/order)`
    });
    pointsEarned = 5;
  }

  // Anomaly Check 2: Check for rapid consecutive awards (e.g. > 3 awards in last 60 seconds)
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const recentAwardsCount = await LoyaltyLog.countDocuments({
    userId,
    type: "earned",
    createdAt: { $gte: oneMinuteAgo }
  });

  if (recentAwardsCount >= 3) {
    await flagLoyaltyAnomaly({
      userId,
      orderId,
      pointsAttempted: pointsEarned,
      orderAmountKES,
      reason: `Rapid loyalty point earning detected (${recentAwardsCount + 1} awards within 60 seconds)`
    });
  }

  if (pointsEarned <= 0) {
    const user = await User.findById(userId).select("loyaltyPoints");
    return {
      pointsEarned: 0,
      currentPoints: user ? user.loyaltyPoints || 0 : 0,
      converted: false,
    };
  }

  // Atomically update user points
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        loyaltyPoints: pointsEarned,
        totalLoyaltyPointsEarned: pointsEarned,
      },
    },
    { new: true }
  );

  if (!updatedUser) {
    throw new Error(`User not found with ID ${userId}`);
  }

  // Log point earning
  await LoyaltyLog.create({
    userId,
    orderId,
    type: "earned",
    points: pointsEarned,
    orderAmountKES: Number(orderAmountKES) || 0,
    balanceAfter: updatedUser.loyaltyPoints,
    description: `Earned ${pointsEarned} loyalty point(s) for order of KES ${orderAmountKES}`,
  });

  console.log(`[Loyalty Engine] Awarded ${pointsEarned} points to user ${userId}. New total: ${updatedUser.loyaltyPoints}`);

  // Check 100-point threshold
  let conversionResult = null;
  if (updatedUser.loyaltyPoints >= 100) {
    console.log(`[Loyalty Engine] Threshold 100 points reached for user ${userId}. Auto-converting...`);
    try {
      conversionResult = await processThresholdConversion(userId);
    } catch (err) {
      console.error(`[Loyalty Engine] Auto-conversion failed for user ${userId}:`, err.message);
    }
  }

  return {
    pointsEarned,
    currentPoints: updatedUser.loyaltyPoints,
    conversionResult,
  };
}

/**
 * Revert loyalty points earned from an order when order is cancelled or user opts out.
 */
async function revertPoints({ userId, orderId = null, orderAmountKES = 0, pointsToRevert = null, reason = "" }) {
  let ptsToDeduct = pointsToRevert !== null && pointsToRevert !== undefined
    ? Number(pointsToRevert)
    : calculatePoints(orderAmountKES);

  if (ptsToDeduct <= 0 && orderId) {
    // Check if we logged earned points for this order previously
    const existingLog = await LoyaltyLog.findOne({ userId, orderId, type: "earned" });
    if (existingLog) {
      ptsToDeduct = existingLog.points || 0;
    }
  }

  if (ptsToDeduct <= 0) {
    return { pointsReverted: 0 };
  }

  const user = await User.findById(userId);
  if (!user) {
    console.warn(`[Loyalty Engine] Cannot revert points: User ${userId} not found`);
    return { pointsReverted: 0 };
  }

  const currentPoints = user.loyaltyPoints || 0;
  const currentTotalEarned = user.totalLoyaltyPointsEarned || 0;

  // Anomaly Check: User balance is less than points to revert (e.g. user converted points before cancelling order)
  if (currentPoints < ptsToDeduct) {
    await flagLoyaltyAnomaly({
      userId,
      orderId,
      pointsAttempted: ptsToDeduct,
      orderAmountKES,
      reason: `Insufficient loyalty points balance (${currentPoints} pts available) to cover reverted ${ptsToDeduct} pts for cancelled order/opt-out.`
    });
  }

  const newPoints = Math.max(0, currentPoints - ptsToDeduct);
  const newTotalEarned = Math.max(0, currentTotalEarned - ptsToDeduct);

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        loyaltyPoints: newPoints,
        totalLoyaltyPointsEarned: newTotalEarned,
      }
    },
    { new: true }
  );

  // Log Loyalty Adjustment
  await LoyaltyLog.create({
    userId,
    orderId,
    type: "adjusted",
    points: -ptsToDeduct,
    orderAmountKES: Number(orderAmountKES) || 0,
    balanceAfter: updatedUser.loyaltyPoints,
    description: reason || `Reverted ${ptsToDeduct} loyalty point(s) due to order cancellation / opt-out.`
  });

  console.log(`[Loyalty Engine] Reverted ${ptsToDeduct} points from user ${userId}. New total: ${updatedUser.loyaltyPoints}`);

  return {
    pointsReverted: ptsToDeduct,
    currentPoints: updatedUser.loyaltyPoints
  };
}

/**
 * Convert accumulated points to active Wallet KES (1 pt = 1 KES) and mint Stellar NT tokens.
 * Only converts in chunks of 100 points (e.g., 100 pts -> 100 KES & 100 NT).
 */
async function processThresholdConversion(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error(`User not found with ID ${userId}`);
  }

  const currentPoints = user.loyaltyPoints || 0;
  if (currentPoints < 100) {
    return {
      success: false,
      message: `Points threshold not met. Current points: ${currentPoints}. Minimum required: 100 points.`,
      currentPoints,
    };
  }

  // Convert ALL accumulated points once the 100-point threshold is reached
  const pointsToConvert = currentPoints;
  const kesToAdd = pointsToConvert; // 1 pt = 1 KES

  // Deduct points from user
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        loyaltyPoints: -pointsToConvert,
        totalLoyaltyPointsConverted: pointsToConvert,
      },
    },
    { new: true }
  );

  // Update user wallet balance
  let wallet = await Wallet.findOne({ user: userId });
  if (!wallet) {
    wallet = await Wallet.create({
      user: userId,
      walletType: user.role || "student",
      availableBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
    });
  }

  const currentWalletAvail = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : "0");
  const newWalletAvail = (currentWalletAvail + kesToAdd).toFixed(2);
  wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString(newWalletAvail);
  await wallet.save();

  // Mint NT tokens on Stellar blockchain
  let stellarTxHash = null;
  try {
    stellarTxHash = await stellarTreasuryService.mintNT(kesToAdd);
    console.log(`[Loyalty Engine] Stellar NT minting success for conversion of KES ${kesToAdd}. Tx Hash: ${stellarTxHash}`);
  } catch (stellarError) {
    console.error(`[Loyalty Engine] Stellar NT minting failed (ledger sync pending):`, stellarError.message);
  }

  // Create audit transaction record
  const txId = `LOYALTY-REWARD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const transaction = await Transaction.create({
    transactionId: txId,
    toUser: userId,
    amountKES: mongoose.Types.Decimal128.fromString(kesToAdd.toFixed(2)),
    transactionCategory: "loyalty_reward",
    paymentMethod: "wallet",
    status: "completed",
    settlementStatus: stellarTxHash ? "synced" : "pending",
    stellarTxHash: stellarTxHash || undefined,
    paymentReference: `Loyalty Points Conversion: ${pointsToConvert} pts -> KES ${kesToAdd}`,
  });

  // Record Ledger Entry
  try {
    await ledgerService.recordLedgerEntry({
      debitWallet: null, // Issued from platform rewards
      creditWallet: wallet._id,
      amountKES: kesToAdd,
      transactionId: transaction._id,
      reference: txId,
      ledgerType: "loyalty_reward",
    });
  } catch (ledgerErr) {
    console.error(`[Loyalty Engine] Ledger entry record error:`, ledgerErr.message);
  }

  // Record Loyalty Conversion Log
  await LoyaltyLog.create({
    userId,
    type: "converted_to_wallet",
    points: -pointsToConvert,
    orderAmountKES: 0,
    balanceAfter: updatedUser.loyaltyPoints,
    description: `Converted ${pointsToConvert} loyalty points to KES ${kesToAdd} active wallet credit.`,
    stellarTxHash,
  });

  return {
    success: true,
    pointsConverted: pointsToConvert,
    kesAdded: kesToAdd,
    remainingPoints: updatedUser.loyaltyPoints,
    newWalletBalanceKES: newWalletAvail,
    stellarTxHash,
  };
}

/**
 * Get detailed loyalty status for a user.
 */
async function getLoyaltyStatus(userId) {
  const user = await User.findById(userId).select("loyaltyPoints totalLoyaltyPointsEarned totalLoyaltyPointsConverted");

  const loyaltyPoints = user ? user.loyaltyPoints || 0 : 0;
  const totalEarned = user ? user.totalLoyaltyPointsEarned || 0 : 0;
  const totalConverted = user ? user.totalLoyaltyPointsConverted || 0 : 0;

  const pointsToThreshold = Math.max(0, 100 - loyaltyPoints);
  const progressPercentage = Math.min(100, Math.round((loyaltyPoints / 100) * 100));
  const isThresholdReached = loyaltyPoints >= 100;

  const logs = await LoyaltyLog.find({ userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return {
    loyaltyPoints,
    kesValue: loyaltyPoints, // 1 pt = 1 KES
    totalEarned,
    totalConverted,
    pointsToThreshold,
    progressPercentage,
    isThresholdReached,
    history: logs,
  };
}

module.exports = {
  calculatePoints,
  awardPoints,
  revertPoints,
  flagLoyaltyAnomaly,
  processThresholdConversion,
  getLoyaltyStatus,
};
