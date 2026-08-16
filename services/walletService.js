const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');
const paymentConfig = require('../config/paymentConfig');
const DeliveryLocation = require('../models/DeliveryLocation');

/**
 * Find or create a user wallet
 */
async function getOrCreateWallet(userId, role = 'student', session = null) {
  const query = Wallet.findOne({ user: userId });
  let wallet = session ? await query.session(session) : await query;
  if (!wallet) {
    const docs = [{
      user: userId,
      walletType: role,
      availableBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
      lockedBalanceKES: mongoose.Types.Decimal128.fromString("0.00"),
      pendingWithdrawalKES: mongoose.Types.Decimal128.fromString("0.00"),
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
  skipTxLog = false,
  extraTxFields = {}
) {
  const wallet = await getOrCreateWallet(userId, 'student', session);
  
  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot credit wallet: Wallet is ${wallet.status}`);
  }

  // Credit locally
  const currentAvailable = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
  wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvailable + parseFloat(amountKes)).toFixed(2));
  
  if (category === 'deposit') {
    const currentDeposited = parseFloat(wallet.totalDepositedKES ? wallet.totalDepositedKES.toString() : '0');
    wallet.totalDepositedKES = mongoose.Types.Decimal128.fromString((currentDeposited + parseFloat(amountKes)).toFixed(2));
  } else if (category === 'refund') {
    const currentRefunded = parseFloat(wallet.totalRefundedKES ? wallet.totalRefundedKES.toString() : '0');
    wallet.totalRefundedKES = mongoose.Types.Decimal128.fromString((currentRefunded + parseFloat(amountKes)).toFixed(2));
  }

  // Update Funding Sources attribution buckets
  let existingSource = wallet.walletFundingSources.find(
    s => s.sourceType === sourceType &&
         s.restrictedUsage === restrictedUsage &&
         s.restrictedUsageType === restrictedUsageType
  );

  if (existingSource) {
    const currentSourceAmt = parseFloat(existingSource.amountKES ? existingSource.amountKES.toString() : '0');
    existingSource.amountKES = mongoose.Types.Decimal128.fromString((currentSourceAmt + parseFloat(amountKes)).toFixed(2));
  } else {
    wallet.walletFundingSources.push({
      sourceType,
      amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
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
    const txId = extraTxFields.transactionId || crypto.randomUUID();
    const txDocs = [{
      transactionId: txId,
      toUser: userId,
      amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
      transactionCategory: category,
      paymentMethod: paymentMethod,
      status: 'completed',
      settlementStatus: 'pending',
      description: description,
      ...extraTxFields
    }];
    const createdTx = session
      ? await Transaction.create(txDocs, { session })
      : await Transaction.create(txDocs);
    tx = createdTx[0];

    // Ledger Entry Log
    try {
      const ledgerService = require('./ledgerService');
      let ledgerType = 'deposit';
      if (category === 'refund') ledgerType = 'refund';
      else if (category === 'funding') ledgerType = 'transfer';
      else if (category === 'vendor_payout') ledgerType = 'escrow_release';

      await ledgerService.recordLedgerEntry({
        debitWallet: null,
        creditWallet: wallet._id,
        amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
        transactionId: txId,
        reference: description || `Wallet credit (${category})`,
        ledgerType
      }, session);
    } catch (ledgerErr) {
      console.error("Failed to create ledger entry during creditWallet:", ledgerErr.message);
    }
  }

  return { wallet, transaction: tx };
}

/**
 * Deduct funds from Wallet Funding Sources following strict prioritization rules
 */
function deductFromFundingSources(wallet, amountKes, isSubscription = false) {
  let remainingToDeduct = parseFloat(amountKes);

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

    const sourceAmt = parseFloat(source.amountKES ? source.amountKES.toString() : '0');
    if (sourceAmt <= 0) continue;

    const deductFromSource = Math.min(sourceAmt, remainingToDeduct);
    source.amountKES = mongoose.Types.Decimal128.fromString((sourceAmt - deductFromSource).toFixed(2));
    remainingToDeduct = parseFloat((remainingToDeduct - deductFromSource).toFixed(2));
    
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
  wallet.walletFundingSources = wallet.walletFundingSources.filter(s => parseFloat(s.amountKES.toString()) > 0);
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
  session = null,
  extraTxFields = {}
) {
  const wallet = await getOrCreateWallet(userId, 'student', session);
  
  if (wallet.status === 'frozen' || wallet.status === 'suspended') {
    throw new Error(`Cannot debit wallet: Wallet is ${wallet.status}`);
  }

  const currentAvailable = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
  if (currentAvailable < parseFloat(amountKes)) {
    throw new Error("Insufficient available balance");
  }

  // Deduct from local buckets
  deductFromFundingSources(wallet, amountKes, isSubscription);

  wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvailable - parseFloat(amountKes)).toFixed(2));
  const currentSpent = parseFloat(wallet.totalSpentKES ? wallet.totalSpentKES.toString() : '0');
  wallet.totalSpentKES = mongoose.Types.Decimal128.fromString((currentSpent + parseFloat(amountKes)).toFixed(2));

  if (session) {
    await wallet.save({ session });
  } else {
    await wallet.save();
  }

  const txId = extraTxFields.transactionId || crypto.randomUUID();
  const txDocs = [{
    transactionId: txId,
    fromUser: userId,
    amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
    transactionCategory: category,
    paymentMethod: paymentMethod,
    status: 'completed',
    settlementStatus: 'pending',
    description: description,
    ...extraTxFields
  }];

  const tx = session
    ? await Transaction.create(txDocs, { session })
    : await Transaction.create(txDocs);

  // Ledger Entry Log
  try {
    const ledgerService = require('./ledgerService');
    let ledgerType = 'withdrawal';
    if (category === 'funding') ledgerType = 'transfer';
    else if (category === 'custom_order' || category === 'ndash_payment') ledgerType = 'escrow_lock';
    
    await ledgerService.recordLedgerEntry({
      debitWallet: wallet._id,
      creditWallet: null,
      amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
      transactionId: txId,
      reference: description || `Wallet debit (${category})`,
      ledgerType
    }, session);
  } catch (ledgerErr) {
    console.error("Failed to create ledger entry during debitWallet:", ledgerErr.message);
  }

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

  const currentAvailable = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
  if (currentAvailable < parseFloat(amountKes)) {
    throw new Error("Insufficient available balance to lock");
  }

  // Deduct from available buckets (enforcing subscription priorities)
  deductFromFundingSources(wallet, amountKes, true);

  wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvailable - parseFloat(amountKes)).toFixed(2));
  const currentLocked = parseFloat(wallet.lockedBalanceKES ? wallet.lockedBalanceKES.toString() : '0');
  wallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString((currentLocked + parseFloat(amountKes)).toFixed(2));

  await wallet.save(session ? { session } : {});
  return wallet;
}

/**
 * Unlock funds: move from locked to available balance
 */
async function unlockFunds(userId, amountKes, session = null) {
  const wallet = await getOrCreateWallet(userId, 'student', session);

  const currentLocked = parseFloat(wallet.lockedBalanceKES ? wallet.lockedBalanceKES.toString() : '0');
  if (currentLocked < parseFloat(amountKes)) {
    throw new Error("Insufficient locked balance to unlock");
  }

  wallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString((currentLocked - parseFloat(amountKes)).toFixed(2));
  const currentAvailable = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
  wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvailable + parseFloat(amountKes)).toFixed(2));

  // Restore as self-funded balance when unlocking
  let selfSource = wallet.walletFundingSources.find(s => s.sourceType === 'self');
  if (selfSource) {
    const currentSelfAmt = parseFloat(selfSource.amountKES ? selfSource.amountKES.toString() : '0');
    selfSource.amountKES = mongoose.Types.Decimal128.fromString((currentSelfAmt + parseFloat(amountKes)).toFixed(2));
  } else {
    wallet.walletFundingSources.push({
      sourceType: 'self',
      amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
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

  let amount = parseFloat(amountKes);

  const currentLocked = parseFloat(wallet.lockedBalanceKES ? wallet.lockedBalanceKES.toString() : '0');
  // Cap refund amount to the actual remaining locked balance
  if (currentLocked < amount) {
    throw new Error(`Refund amount KES ${amount} exceeds lockedBalanceKES KES ${currentLocked}`);
  }

  if (amount <= 0) {
    console.log(`[Refund Capping] Locked balance is 0 KES. Skipping refund credit operation.`);
    return wallet;
  }

  // Move from locked → available (net tokenBalanceNT stays the same)
  wallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString((currentLocked - amount).toFixed(2));
  const currentAvailable = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
  wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvailable + amount).toFixed(2));
  const currentRefunded = parseFloat(wallet.totalRefundedKES ? wallet.totalRefundedKES.toString() : '0');
  wallet.totalRefundedKES = mongoose.Types.Decimal128.fromString((currentRefunded + amount).toFixed(2));

  // Add back to designated funding sources bucket
  let existingSource = wallet.walletFundingSources.find(
    s => s.sourceType === sourceType && s.restrictedUsageType === 'none'
  );

  if (existingSource) {
    const currentSourceAmt = parseFloat(existingSource.amountKES ? existingSource.amountKES.toString() : '0');
    existingSource.amountKES = mongoose.Types.Decimal128.fromString((currentSourceAmt + amount).toFixed(2));
  } else {
    wallet.walletFundingSources.push({
      sourceType,
      amountKES: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
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
  return parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
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
 * Process a custom order paid instantly from student wallet into Escrow (locked balance)
 */
async function processWalletCustomOrder(userId, vendorUserId, items, totalCost, deliveryLocation, name, phone, session = null) {
  // 1. Lock funds in student wallet (moves available -> lockedBalanceKES)
  const studentWallet = await lockFunds(userId, totalCost, session);

  // 2. Create custom order lock transaction in MongoDB
  const txId = crypto.randomUUID();
  const txDocs = [{
    transactionId: txId,
    fromUser: userId,
    toUser: vendorUserId,
    amountKES: mongoose.Types.Decimal128.fromString(parseFloat(totalCost).toFixed(2)),
    transactionCategory: 'custom_order',
    paymentMethod: 'wallet',
    paymentSource: 'student_wallet',
    orderType: 'custom',
    status: 'completed',
    settlementStatus: 'pending',
    description: `Escrow lock for quick custom order`
  }];

  const tx = session
    ? await Transaction.create(txDocs, { session })
    : await Transaction.create(txDocs);

  // 3. Queue on-chain transaction asynchronously to lock funds on Stellar
  try {
    const queueService = require('./queueService');
    await queueService.addStellarJob('subscription_lock', tx[0]._id, { amountKES: totalCost });
  } catch (queueErr) {
    console.error("[Wallet Service] Failed to queue Stellar job for custom order lock:", queueErr.message);
  }

  return { studentWallet, transaction: tx[0] };
}

/**
 * Process a successful direct M-Pesa custom order checkout into Escrow (locked balance)
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

  // 2. Lock M-Pesa funds into student wallet locked balance (Escrow)
  const studentWallet = await getOrCreateWallet(order.user, 'student', session);
  const currentLocked = parseFloat(studentWallet.lockedBalanceKES ? studentWallet.lockedBalanceKES.toString() : '0');
  studentWallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString((currentLocked + parseFloat(amountPaid)).toFixed(2));
  await studentWallet.save(session ? { session } : {});

  // 3. Create transaction log representing direct M-Pesa payment into Escrow
  const txDocs = [{
    transactionId: crypto.randomUUID(),
    fromUser: order.user || null,
    toUser: order.vendor,
    amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountPaid).toFixed(2)),
    transactionCategory: 'mpesa_direct_order',
    paymentMethod: 'mpesa',
    paymentSource: 'mpesa_direct',
    orderType: 'custom',
    status: 'completed',
    settlementStatus: 'pending',
    description: `Direct M-Pesa checkout for order ${order.orderId} (Receipt: ${mpesaReceiptNumber})`
  }];

  const tx = session
    ? await Transaction.create(txDocs, { session })
    : await Transaction.create(txDocs);

  // 4. Queue on-chain transaction asynchronously to mint NutriTokens (NT) on Stellar
  try {
    const queueService = require('./queueService');
    await queueService.addStellarJob('deposit', tx[0]._id, { amountKES: amountPaid });
  } catch (queueErr) {
    console.error("[Wallet Service] Failed to queue Stellar deposit job:", queueErr.message);
  }

  // 5. Create matching Delivery record for quick order (paymentReleased = false)
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
    paymentReleased: false,
    isCustom: true
  }], session ? { session } : {});

  return { order, studentWallet };
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
    );    // 2. Deduct vendor share
    if (vendorProfile) {
      const vendorWallet = await getOrCreateWallet(vendorProfile.user, 'vendor', session);
      const currentVendorAvail = parseFloat(vendorWallet.availableBalanceKES ? vendorWallet.availableBalanceKES.toString() : '0');
      vendorWallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentVendorAvail - vendorShare).toFixed(2));
      
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
      const currentVendorAvail = parseFloat(vendorWallet.availableBalanceKES ? vendorWallet.availableBalanceKES.toString() : '0');
      vendorWallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentVendorAvail - vendorShare).toFixed(2));
      
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
