const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');
const paymentConfig = require('../config/paymentConfig');

/**
 * Find or create a user wallet
 */
async function getOrCreateWallet(userId, role = 'student', session = null) {
  let wallet = await Wallet.findOne({ user: userId }).session(session);
  if (!wallet) {
    wallet = await Wallet.create([{
      user: userId,
      walletType: role,
      availableBalanceKES: 0,
      lockedBalanceKES: 0,
      pendingWithdrawalKES: 0,
      status: 'active'
    }], { session });
    wallet = wallet[0];
  }
  return wallet;
}

/**
 * Credit available balance to a user's wallet
 */
async function creditWallet(userId, amountKes, category, paymentMethod, description = "", session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);
  
  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot credit wallet: Wallet is ${wallet.status}`);
  }

  wallet.availableBalanceKES += Number(amountKes);
  
  if (category === 'deposit') {
    wallet.totalDepositedKES += Number(amountKes);
  } else if (category === 'refund') {
    wallet.totalRefundedKES += Number(amountKes);
  }

  await wallet.save({ session });

  const tx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    toUser: userId,
    amountKES: Number(amountKes),
    transactionCategory: category,
    paymentMethod: paymentMethod,
    status: 'completed',
    description: description
  }], { session });

  return { wallet, transaction: tx[0] };
}

/**
 * Debit available balance from a user's wallet
 */
async function debitWallet(userId, amountKes, category, paymentMethod, description = "", session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);
  
  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot debit wallet: Wallet is ${wallet.status}`);
  }

  if (wallet.availableBalanceKES < Number(amountKes)) {
    throw new Error("Insufficient available balance");
  }

  wallet.availableBalanceKES -= Number(amountKes);
  wallet.totalSpentKES += Number(amountKes);

  await wallet.save({ session });

  const tx = await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: userId,
    amountKES: Number(amountKes),
    transactionCategory: category,
    paymentMethod: paymentMethod,
    status: 'completed',
    description: description
  }], { session });

  return { wallet, transaction: tx[0] };
}

/**
 * Lock funds: move from available to locked balance
 */
async function lockFunds(userId, amountKes, session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);

  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot lock funds: Wallet is ${wallet.status}`);
  }

  if (wallet.availableBalanceKES < Number(amountKes)) {
    throw new Error("Insufficient available balance to lock");
  }

  wallet.availableBalanceKES -= Number(amountKes);
  wallet.lockedBalanceKES += Number(amountKes);

  await wallet.save({ session });
  return wallet;
}

/**
 * Unlock funds: move from locked to available balance
 */
async function unlockFunds(userId, amountKes, session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);

  if (wallet.lockedBalanceKES < Number(amountKes)) {
    throw new Error("Insufficient locked balance to unlock");
  }

  wallet.lockedBalanceKES -= Number(amountKes);
  wallet.availableBalanceKES += Number(amountKes);

  await wallet.save({ session });
  return wallet;
}

/**
 * Process refund: Release from lockedBalanceKES and credit availableBalanceKES (either Student or Sponsor)
 */
async function refundFunds(userId, amountKes, category, session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);

  wallet.availableBalanceKES += Number(amountKes);
  wallet.totalRefundedKES += Number(amountKes);

  await wallet.save({ session });
  return wallet;
}

/**
 * Get spendable balance of a wallet (returns availableBalanceKES only)
 */
async function getSpendableBalance(userId, role = 'student', session = null) {
  const wallet = await getOrCreateWallet(userId, role, session);
  return wallet.availableBalanceKES;
}

/**
 * Split custom order revenue into vendor share and platform commission
 */
function splitCustomOrderRevenue(orderTotal) {
  const platformRate = paymentConfig.platformCommissionRate || 0.10;
  const deliveryFee = paymentConfig.deliveryFeeRate || 0;
  
  const commission = Number((orderTotal * platformRate).toFixed(2));
  const vendorShare = Number((orderTotal - commission - deliveryFee).toFixed(2));
  
  return {
    vendorShare,
    commission,
    deliveryFee
  };
}

/**
 * Process a custom order paid instantly from student wallet
 */
async function processWalletCustomOrder(userId, vendorUserId, items, totalCost, deliveryLocation, name, phone, session = null) {
  // 1. Debit student wallet (checks availableBalanceKES >= totalCost inside debitWallet)
  const debitResult = await debitWallet(
    userId,
    totalCost,
    'custom_order',
    'wallet',
    `Custom order payment`,
    session
  );
  
  // Set paymentSource for auditing
  debitResult.transaction.paymentSource = 'student_wallet';
  await debitResult.transaction.save({ session });

  // 2. Split revenue
  const { vendorShare, commission } = splitCustomOrderRevenue(totalCost);

  // 3. Credit Vendor wallet available balance instantly
  const creditResult = await creditWallet(
    vendorUserId,
    vendorShare,
    'vendor_payout',
    'wallet',
    `Custom order payout`,
    session
  );
  creditResult.transaction.paymentSource = 'student_wallet';
  await creditResult.transaction.save({ session });

  // 4. Create commission transaction log in MongoDB
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: userId,
    toUser: vendorUserId,
    amountKES: commission,
    transactionCategory: 'commission',
    paymentMethod: 'wallet',
    paymentSource: 'student_wallet',
    status: 'completed',
    description: `Platform commission for custom order`
  }], { session });

  return { debitResult, creditResult, vendorShare, commission };
}

/**
 * Process a successful direct M-Pesa custom order checkout
 */
async function processMpesaDirectCustomOrder(checkoutRequestID, amountPaid, mpesaReceiptNumber, phonePaidFrom, session = null) {
  const CustomOrder = require('../models/CustomOrder');
  
  const order = await CustomOrder.findOne({ checkoutRequestID }).session(session);
  if (!order) throw new Error(`Custom order with checkoutRequestID ${checkoutRequestID} not found`);
  
  if (order.status === 'preparing' || order.status === 'ready' || order.status === 'delivered') {
    return { alreadyProcessed: true };
  }

  // 1. Update order status to paid and preparing
  order.status = 'preparing';
  await order.save({ session });

  // 2. Find vendor user
  const Vendor = require('../models/Vendor');
  const vendorProfile = await Vendor.findById(order.vendor).session(session);
  if (!vendorProfile) throw new Error("Vendor not found");

  // 3. Split revenue
  const { vendorShare, commission } = splitCustomOrderRevenue(amountPaid);

  // 4. Credit vendor available balance instantly
  const creditResult = await creditWallet(
    vendorProfile.user,
    vendorShare,
    'vendor_payout',
    'mpesa',
    `Custom order direct M-Pesa payout (Receipt: ${mpesaReceiptNumber})`,
    session
  );
  creditResult.transaction.paymentSource = 'mpesa_direct';
  await creditResult.transaction.save({ session });

  // 5. Create platform commission transaction log in MongoDB
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: order.user || null,
    toUser: vendorProfile.user,
    amountKES: commission,
    transactionCategory: 'commission',
    paymentMethod: 'mpesa',
    paymentSource: 'mpesa_direct',
    status: 'completed',
    description: `Platform commission for direct M-Pesa order (Receipt: ${mpesaReceiptNumber})`
  }], { session });

  // 6. Create custom order transaction log representing the user's direct payment
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: order.user || null,
    toUser: vendorProfile.user,
    amountKES: amountPaid,
    transactionCategory: 'mpesa_direct_order',
    paymentMethod: 'mpesa',
    paymentSource: 'mpesa_direct',
    status: 'completed',
    description: `Direct M-Pesa checkout for order ${order.orderId} (Receipt: ${mpesaReceiptNumber})`
  }], { session });

  return { order, vendorShare, commission };
}

/**
 * Refund custom order (failed, rejected, undelivered) back to wallet or log transaction back to original source
 */
async function refundCustomOrder(orderId, session = null) {
  const CustomOrder = require('../models/CustomOrder');
  const order = await CustomOrder.findById(orderId).session(session);
  if (!order) throw new Error("Custom order not found");
  
  if (order.status === 'cancelled' || order.status === 'failed') {
    return { alreadyRefunded: true };
  }

  const { vendorShare } = splitCustomOrderRevenue(order.totalCost);

  // Update order status
  order.status = 'cancelled';
  await order.save({ session });

  const Vendor = require('../models/Vendor');
  const vendorProfile = await Vendor.findById(order.vendor).session(session);

  if (order.paymentMethod === 'wallet') {
    // 1. Credit student wallet available balance
    await creditWallet(
      order.user,
      order.totalCost,
      'refund',
      'wallet',
      `Refund for custom order ${order.orderId}`,
      session
    );

    // 2. Deduct vendor share
    if (vendorProfile) {
      const vendorWallet = await getOrCreateWallet(vendorProfile.user, 'vendor', session);
      vendorWallet.availableBalanceKES -= vendorShare;
      await vendorWallet.save({ session });
      
      // Log negative transfer
      await Transaction.create([{
        transactionId: crypto.randomUUID(),
        fromUser: vendorProfile.user,
        toUser: order.user,
        amountKES: vendorShare,
        transactionCategory: 'refund',
        paymentMethod: 'wallet',
        status: 'completed',
        description: `Vendor refund deduction for custom order ${order.orderId}`
      }], { session });
    }
  } else if (order.paymentMethod === 'mpesa_direct') {
    // Direct M-Pesa refund simulation
    await Transaction.create([{
      transactionId: crypto.randomUUID(),
      toUser: order.user || null,
      amountKES: order.totalCost,
      transactionCategory: 'refund',
      paymentMethod: 'mpesa',
      status: 'completed',
      description: `M-Pesa refund of custom order ${order.orderId} to original source`
    }], { session });

    // Deduct vendor share
    if (vendorProfile) {
      const vendorWallet = await getOrCreateWallet(vendorProfile.user, 'vendor', session);
      vendorWallet.availableBalanceKES -= vendorShare;
      await vendorWallet.save({ session });

      await Transaction.create([{
        transactionId: crypto.randomUUID(),
        fromUser: vendorProfile.user,
        amountKES: vendorShare,
        transactionCategory: 'refund',
        paymentMethod: 'mpesa',
        status: 'completed',
        description: `Vendor refund deduction (M-Pesa) for custom order ${order.orderId}`
      }], { session });
    }
  }

  return order;
}

module.exports = {
  getOrCreateWallet,
  creditWallet,
  debitWallet,
  lockFunds,
  unlockFunds,
  refundFunds,
  getSpendableBalance,
  splitCustomOrderRevenue,
  processWalletCustomOrder,
  processMpesaDirectCustomOrder,
  refundCustomOrder
};
