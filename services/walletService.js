const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');
const paymentConfig = require('../config/paymentConfig');
const DeliveryLocation = require('../models/DeliveryLocation');

/**
 * Find or create a user wallet
 */
async function getOrCreateWallet(userId, role = 'student', session = null) {
  // Guard: only chain .session() when session is a real ClientSession, not null.
  // Passing .session(null) can cause "session.inTransaction is not a function" in some
  // MongoDB driver versions because it sets an explicit null session object.
  const query = Wallet.findOne({ user: userId });
  let wallet = session ? await query.session(session) : await query;
  if (!wallet) {
    const docs = [{
      user: userId,
      walletType: role,
      availableBalanceKES: 0,
      lockedBalanceKES: 0,
      pendingWithdrawalKES: 0,
      status: 'active',
      walletFundingSources: []
    }];
    const createdWallet = session ? await Wallet.create(docs, { session }) : await Wallet.create(docs);
    wallet = createdWallet[0];
  }
  return wallet;
}

/**
 * Credit available balance to a user's wallet (including attribution system)
 */
async function creditWallet(
  userId,
  amountKes,
  category,
  paymentMethod,
  description = "",
  sourceType = 'self',
  restrictedUsage = false,
  restrictedUsageType = 'none',
  session = null,
  skipTxLog = false
) {
  const wallet = await getOrCreateWallet(userId, 'student', session);
  
  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot credit wallet: Wallet is ${wallet.status}`);
  }

  // Credit locally
  wallet.availableBalanceKES = Number((wallet.availableBalanceKES + Number(amountKes)).toFixed(2));
  
  if (category === 'deposit') {
    wallet.totalDepositedKES = Number((wallet.totalDepositedKES + Number(amountKes)).toFixed(2));
  } else if (category === 'refund') {
    wallet.totalRefundedKES = Number((wallet.totalRefundedKES + Number(amountKes)).toFixed(2));
  }

  // Update Funding Sources attribution buckets
  let existingSource = wallet.walletFundingSources.find(
    s => s.sourceType === sourceType &&
         s.restrictedUsage === restrictedUsage &&
         s.restrictedUsageType === restrictedUsageType
  );

  if (existingSource) {
    existingSource.amountKES = Number((existingSource.amountKES + Number(amountKes)).toFixed(2));
  } else {
    wallet.walletFundingSources.push({
      sourceType,
      amountKES: Number(amountKes),
      restrictedUsage,
      restrictedUsageType,
      nutritionCategory: [],
      expiryDate: null
    });
  }

  // Save changes (runs pre-save hook to keep tokenBalanceNT in sync!)
  if (session) {
    await wallet.save({ session });
  } else {
    await wallet.save();
  }

  let tx = null;
  if (!skipTxLog) {
    const txDocs = [{
      transactionId: crypto.randomUUID(),
      toUser: userId,
      amountKES: Number(amountKes),
      transactionCategory: category,
      paymentMethod: paymentMethod,
      status: 'completed',
      settlementStatus: 'pending',
      description: description
    }];
    const createdTx = session
      ? await Transaction.create(txDocs, { session })
      : await Transaction.create(txDocs);
    tx = createdTx[0];
  }

  return { wallet, transaction: tx };
}

/**
 * Deduct funds from Wallet Funding Sources following strict prioritization rules
 */
function deductFromFundingSources(wallet, amountKes, isSubscription = false) {
  let remainingToDeduct = Number(amountKes);

  // Sorting priorities:
  // For Subscriptions:
  // 1. Sponsored subscription-only restricted (sourceType='sponsor', restrictedUsageType='subscription_only')
  // 2. Sponsored unrestricted surplus (sourceType='sponsor', restrictedUsage=false)
  // 3. Self-funded (sourceType='self')
  // 4. Others
  //
  // For Custom Orders / General Debits:
  // 1. Sponsored unrestricted surplus (sourceType='sponsor', restrictedUsage=false)
  // 2. Self-funded (sourceType='self')
  // (Skip/lowest priority for subscription-only restricted)
  
  let sortedSources = [...wallet.walletFundingSources];
  sortedSources.sort((a, b) => {
    const getPriority = (source) => {
      if (isSubscription) {
        if (source.sourceType === 'sponsor' && source.restrictedUsageType === 'subscription_only') return 1;
        if (source.sourceType === 'sponsor' && !source.restrictedUsage) return 2;
        if (source.sourceType === 'self') return 3;
        return 4;
      } else {
        if (source.sourceType === 'sponsor' && !source.restrictedUsage) return 1;
        if (source.sourceType === 'self') return 2;
        if (source.restrictedUsageType === 'subscription_only') return 99; // strictly skip or push to end
        return 3;
      }
    };
    return getPriority(a) - getPriority(b);
  });

  for (let source of sortedSources) {
    if (remainingToDeduct <= 0) break;

    // Custom orders MUST NOT consume subscription_only restricted usage funds
    if (!isSubscription && source.restrictedUsageType === 'subscription_only') {
      continue;
    }

    const deductFromSource = Math.min(source.amountKES, remainingToDeduct);
    source.amountKES = Number((source.amountKES - deductFromSource).toFixed(2));
    remainingToDeduct = Number((remainingToDeduct - deductFromSource).toFixed(2));
    
    // Find the original source reference and update it
    let orig = wallet.walletFundingSources.find(
      s => s.sourceType === source.sourceType &&
           s.restrictedUsage === source.restrictedUsage &&
           s.restrictedUsageType === source.restrictedUsageType
    );
    if (orig) {
      orig.amountKES = source.amountKES;
    }
  }

  if (remainingToDeduct > 0) {
    throw new Error("Insufficient matching funds within wallet buckets");
  }

  // Filter out completely depleted sources
  wallet.walletFundingSources = wallet.walletFundingSources.filter(s => s.amountKES > 0);
}

/**
 * Debit available balance from a user's wallet
 */
async function debitWallet(
  userId,
  amountKes,
  category,
  paymentMethod,
  description = "",
  isSubscription = false,
  session = null
) {
  const wallet = await getOrCreateWallet(userId, 'student', session);
  
  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot debit wallet: Wallet is ${wallet.status}`);
  }

  if (wallet.availableBalanceKES < Number(amountKes)) {
    throw new Error("Insufficient available balance");
  }

  // Deduct from local buckets
  deductFromFundingSources(wallet, amountKes, isSubscription);

  wallet.availableBalanceKES = Number((wallet.availableBalanceKES - Number(amountKes)).toFixed(2));
  wallet.totalSpentKES = Number((wallet.totalSpentKES + Number(amountKes)).toFixed(2));

  if (session) {
    await wallet.save({ session });
  } else {
    await wallet.save();
  }

  const tx = session
    ? await Transaction.create([{
        transactionId: crypto.randomUUID(),
        fromUser: userId,
        amountKES: Number(amountKes),
        transactionCategory: category,
        paymentMethod: paymentMethod,
        status: 'completed',
        settlementStatus: 'pending',
        description: description
      }], { session })
    : await Transaction.create([{
        transactionId: crypto.randomUUID(),
        fromUser: userId,
        amountKES: Number(amountKes),
        transactionCategory: category,
        paymentMethod: paymentMethod,
        status: 'completed',
        settlementStatus: 'pending',
        description: description
      }]);

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

  // Deduct from available buckets (enforcing subscription priorities)
  deductFromFundingSources(wallet, amountKes, true);

  wallet.availableBalanceKES = Number((wallet.availableBalanceKES - Number(amountKes)).toFixed(2));
  wallet.lockedBalanceKES = Number((wallet.lockedBalanceKES + Number(amountKes)).toFixed(2));

  await wallet.save(session ? { session } : {});
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

  wallet.lockedBalanceKES = Number((wallet.lockedBalanceKES - Number(amountKes)).toFixed(2));
  wallet.availableBalanceKES = Number((wallet.availableBalanceKES + Number(amountKes)).toFixed(2));

  // Restore as self-funded balance when unlocking
  let selfSource = wallet.walletFundingSources.find(s => s.sourceType === 'self');
  if (selfSource) {
    selfSource.amountKES = Number((selfSource.amountKES + Number(amountKes)).toFixed(2));
  } else {
    wallet.walletFundingSources.push({
      sourceType: 'self',
      amountKES: Number(amountKes),
      restrictedUsage: false,
      restrictedUsageType: 'none',
      nutritionCategory: [],
      expiryDate: null
    });
  }

  await wallet.save(session ? { session } : {});
  return wallet;
}

/**
 * Process refund: Release from lockedBalanceKES and credit availableBalanceKES
 * IMPORTANT: This assumes the refund amount comes FROM locked funds.
 * tokenBalanceNT (available + locked) must remain unchanged after a pure refund.
 */
async function refundFunds(userId, amountKes, category, sourceType = 'self', session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);

  let amount = Number(amountKes);

  // Cap refund amount to the actual remaining locked balance
  if (wallet.lockedBalanceKES < amount) {
    throw new Error(`Refund amount KES ${amount} exceeds lockedBalanceKES KES ${wallet.lockedBalanceKES}`);
  }

  if (amount <= 0) {
    console.log(`[Refund Capping] Locked balance is 0 KES. Skipping refund credit operation.`);
    return wallet;
  }

  // Move from locked → available (net tokenBalanceNT stays the same)
  wallet.lockedBalanceKES = Number((wallet.lockedBalanceKES - amount).toFixed(2));
  wallet.availableBalanceKES = Number((wallet.availableBalanceKES + amount).toFixed(2));
  wallet.totalRefundedKES = Number((wallet.totalRefundedKES + amount).toFixed(2));

  // Add back to designated funding sources bucket
  let existingSource = wallet.walletFundingSources.find(
    s => s.sourceType === sourceType && s.restrictedUsageType === 'none'
  );

  if (existingSource) {
    existingSource.amountKES = Number((existingSource.amountKES + amount).toFixed(2));
  } else {
    wallet.walletFundingSources.push({
      sourceType,
      amountKES: amount,
      restrictedUsage: false,
      restrictedUsageType: 'none',
      nutritionCategory: [],
      expiryDate: null
    });
  }

  if (session) {
    await wallet.save({ session });
  } else {
    await wallet.save();
  }
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
async function splitCustomOrderRevenue(orderTotal, vendorUserId) {
  let platformCommissionPercent = 10;
  if (vendorUserId) {
    const Vendor = require('../models/Vendor');
    const vendorProfile = await Vendor.findOne({ user: vendorUserId });
    if (vendorProfile && vendorProfile.platformCommissionPercent !== undefined) {
      platformCommissionPercent = vendorProfile.platformCommissionPercent;
    }
  }
  const platformRate = platformCommissionPercent / 100;
  const deliveryFee = paymentConfig.deliveryFeeRate || 0;
  
  const commission = Number((orderTotal * platformRate).toFixed(2));
  const vendorShare = Number((orderTotal - commission - deliveryFee).toFixed(2));
  
  return {
    vendorShare,
    commission,
    deliveryFee,
    platformCommissionPercent
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
    false, // isSubscription = false
    session
  );
  
  // Set paymentSource for auditing
  debitResult.transaction.paymentSource = 'student_wallet';
  await debitResult.transaction.save(session ? { session } : {});

  // 2. Split revenue
  const { vendorShare, commission, platformCommissionPercent } = await splitCustomOrderRevenue(totalCost, vendorUserId);

  // 3. Credit Vendor wallet available balance instantly
  const creditResult = await creditWallet(
    vendorUserId,
    vendorShare,
    'vendor_payout',
    'wallet',
    `Custom order payout`,
    'self',
    false,
    'none',
    session
  );
  creditResult.transaction.paymentSource = 'student_wallet';
  await creditResult.transaction.save(session ? { session } : {});

  // 4. Create commission transaction log in MongoDB
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: vendorUserId,
    toUser: null,
    amountKES: commission,
    transactionCategory: 'commission',
    paymentMethod: 'wallet',
    paymentSource: 'student_wallet',
    status: 'completed',
    settlementStatus: 'pending',
    description: `Platform commission (${platformCommissionPercent}%) for custom order`
  }], session ? { session } : {});

  return { debitResult, creditResult, vendorShare, commission };
}

/**
 * Process a successful direct M-Pesa custom order checkout
 */
async function processMpesaDirectCustomOrder(checkoutRequestID, amountPaid, mpesaReceiptNumber, phonePaidFrom, session = null) {
  const CustomOrder = require('../models/CustomOrder');
  
  const order = session ? await CustomOrder.findOne({ checkoutRequestID }).session(session) : await CustomOrder.findOne({ checkoutRequestID });
  if (!order) throw new Error(`Custom order with checkoutRequestID ${checkoutRequestID} not found`);
  
  if (order.status === 'preparing' || order.status === 'ready' || order.status === 'delivered') {
    return { alreadyProcessed: true };
  }

  // 1. Update order status to paid and preparing
  order.status = 'preparing';
  await order.save(session ? { session } : {});

  // 2. Find vendor user
  const Vendor = require('../models/Vendor');
  const vendorProfile = session ? await Vendor.findById(order.vendor).session(session) : await Vendor.findById(order.vendor);
  if (!vendorProfile) throw new Error("Vendor not found");

  // 3. Split revenue
  const { vendorShare, commission, platformCommissionPercent } = await splitCustomOrderRevenue(amountPaid, vendorProfile.user);

  // 4. Credit vendor available balance instantly
  const creditResult = await creditWallet(
    vendorProfile.user,
    vendorShare,
    'vendor_payout',
    'mpesa',
    `Custom order direct M-Pesa payout (Receipt: ${mpesaReceiptNumber})`,
    'self',
    false,
    'none',
    session
  );
  creditResult.transaction.paymentSource = 'mpesa_direct';
  await creditResult.transaction.save(session ? { session } : {});

  // 5. Create platform commission transaction log in MongoDB
  await Transaction.create([{
    transactionId: crypto.randomUUID(),
    fromUser: vendorProfile.user, // Vendor pays commission!
    toUser: null, // to Platform/System
    amountKES: commission,
    transactionCategory: 'commission',
    paymentMethod: 'mpesa',
    paymentSource: 'mpesa_direct',
    status: 'completed',
    settlementStatus: 'pending',
    description: `Platform commission (${platformCommissionPercent}%) for direct M-Pesa order (Receipt: ${mpesaReceiptNumber})`
  }], session ? { session } : {});

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
    settlementStatus: 'pending',
    description: `Direct M-Pesa checkout for order ${order.orderId} (Receipt: ${mpesaReceiptNumber})`
  }], session ? { session } : {});

  // 7. Create matching Delivery record for quick order
  const Student = require('../models/Student');
  const DeliveryLocation = require('../models/DeliveryLocation');
  const studentProfile = session ? await Student.findOne({ user: order.user }).session(session) : await Student.findOne({ user: order.user });
  const Delivery = require('../models/Delivery');

  // Resolve deliveryLocation ObjectId — use stored ID or resolve from hostel string
  let resolvedLocId = studentProfile?.deliveryLocation || null;
  const resolvedLocName = studentProfile?.hostel || '';
  if (!resolvedLocId && resolvedLocName && resolvedLocName !== 'Campus') {
    const dl = await DeliveryLocation.findOne({
      hostelResidence: new RegExp(resolvedLocName.trim(), 'i')
    });
    if (dl) {
      resolvedLocId = dl._id;
      // Persist resolved deliveryLocation back to the student profile (outside session to avoid locking)
      Student.updateOne({ user: order.user }, { deliveryLocation: dl._id }).exec().catch(() => {});
    }
  }
  // Build a full location description string for the driver
  const locationParts = [
    resolvedLocName || 'Campus',
    studentProfile?.block ? `Block ${studentProfile.block}` : null,
    studentProfile?.floor ? `Floor ${studentProfile.floor}` : null,
    studentProfile?.room ? `Room ${studentProfile.room}` : null,
    studentProfile?.landmark ? `(${studentProfile.landmark})` : null,
  ].filter(Boolean);
  const fullLocation = locationParts.join(', ');

  await Delivery.create([{
    student: order.user,
    vendor: order.vendor,
    items: order.items,
    status: 'pending',
    totalCost: order.totalCost,
    timeSlot: (() => {
      const now = new Date();
      const kenyaHour = (now.getUTCHours() + 3) % 24;
      if (kenyaHour < 10) return 'Breakfast';
      if (kenyaHour < 14) return 'Lunch';
      if (kenyaHour < 20) return 'Supper';
      return 'Breakfast'; // past supper, push to tomorrow's breakfast
    })(),
    scheduledDate: (() => {
      const now = new Date();
      const kenyaHour = (now.getUTCHours() + 3) % 24;
      if (kenyaHour >= 20) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      }
      return now;
    })(),
    location: fullLocation || order.deliveryLocation || 'Campus',
    deliveryLocation: resolvedLocId || null,
    isCustom: true
  }], session ? { session } : {});

  return { order, vendorShare, commission };
}

/**
 * Refund custom order (failed, rejected, undelivered) back to wallet or log transaction back to original source
 */
async function refundCustomOrder(orderId, session = null) {
  const CustomOrder = require('../models/CustomOrder');
  const order = session ? await CustomOrder.findById(orderId).session(session) : await CustomOrder.findById(orderId);
  if (!order) throw new Error("Custom order not found");
  
  const Vendor = require('../models/Vendor');
  const vendorProfile = session ? await Vendor.findOne({ _id: order.vendor }).session(session) : await Vendor.findOne({ _id: order.vendor });
  const vendorUserId = vendorProfile ? vendorProfile.user : null;

  const { vendorShare } = await splitCustomOrderRevenue(order.totalCost, vendorUserId);

  // Update order status
  order.status = 'cancelled';
  await order.save(session ? { session } : {});

  if (order.paymentMethod === 'wallet') {
    // 1. Credit student wallet available balance
    await creditWallet(
      order.user,
      order.totalCost,
      'refund',
      'wallet',
      `Refund for custom order ${order.orderId}`,
      'self',
      false,
      'none',
      session
    );

    // 2. Deduct vendor share
    if (vendorProfile) {
      const vendorWallet = await getOrCreateWallet(vendorProfile.user, 'vendor', session);
      vendorWallet.availableBalanceKES = Number((vendorWallet.availableBalanceKES - vendorShare).toFixed(2));
      
      // Deduct from vendor available funding sources
      try {
        deductFromFundingSources(vendorWallet, vendorShare, false);
      } catch (err) {
        console.warn(`Vendor wallet funding sources trace deduction failed: ${err.message}. Direct debit enforced.`);
      }
      
      await vendorWallet.save(session ? { session } : {});
      
      // Log negative transfer
      await Transaction.create([{
        transactionId: crypto.randomUUID(),
        fromUser: vendorProfile.user,
        toUser: order.user,
        amountKES: vendorShare,
        transactionCategory: 'refund',
        paymentMethod: 'wallet',
        status: 'completed',
        settlementStatus: 'pending',
        description: `Vendor refund deduction for custom order ${order.orderId}`
      }], session ? { session } : {});
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
      settlementStatus: 'pending',
      description: `M-Pesa refund of custom order ${order.orderId} to original source`
    }], session ? { session } : {});

    // Deduct vendor share
    if (vendorProfile) {
      const vendorWallet = await getOrCreateWallet(vendorProfile.user, 'vendor', session);
      vendorWallet.availableBalanceKES = Number((vendorWallet.availableBalanceKES - vendorShare).toFixed(2));
      
      try {
        deductFromFundingSources(vendorWallet, vendorShare, false);
      } catch (err) {
        console.warn(`Vendor wallet funding sources trace deduction failed: ${err.message}. Direct debit enforced.`);
      }
      
      await vendorWallet.save(session ? { session } : {});

      await Transaction.create([{
        transactionId: crypto.randomUUID(),
        fromUser: vendorProfile.user,
        amountKES: vendorShare,
        transactionCategory: 'refund',
        paymentMethod: 'mpesa',
        status: 'completed',
        settlementStatus: 'pending',
        description: `Vendor refund deduction (M-Pesa) for custom order ${order.orderId}`
      }], session ? { session } : {});
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
