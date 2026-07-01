const mongoose = require('mongoose');
const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const walletService = require('./walletService');
const stellarTreasuryService = require('./stellarTreasuryService');
const crypto = require('crypto');

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily deductions...');
  await processDailyDeductions();
});

const processDailyDeductions = async () => {
  const subscriptions = await Subscription.find({ status: 'active', endDate: { $gte: new Date() } })
    .populate('student')
    .populate('meal');

  for (const sub of subscriptions) {
    try {
      const studentWallet = await Wallet.findOne({ user: sub.student._id });
      if (!studentWallet) {
        console.error(`Student wallet not found for subscription ${sub._id}`);
        continue;
      }

      // Resolve Vendor
      const meal = sub.meal;
      if (!meal || !meal.vendor) {
        console.error(`Vendor not linked to meal for subscription ${sub._id}`);
        continue;
      }
      
      const Vendor = require('../models/Vendor');
      const vendorProfile = await Vendor.findById(meal.vendor);
      if (!vendorProfile) {
        console.error(`Vendor profile not found for vendor ${meal.vendor}`);
        continue;
      }
      
      const vendorWallet = await Wallet.findOne({ user: vendorProfile.user });
      if (!vendorWallet) {
        console.error(`Vendor wallet not found for user ${vendorProfile.user}`);
        continue;
      }

      const dailyCost = Number(sub.dailyCost || 0);
      if (dailyCost <= 0) continue;

      // Split cost: Vendor dynamic commission rate, Platform dynamic commission rate
      const vendorCommission = vendorProfile.vendorCommissionPercent !== undefined ? vendorProfile.vendorCommissionPercent : 90;
      const platformCommission = vendorProfile.platformCommissionPercent !== undefined ? vendorProfile.platformCommissionPercent : 10;
      const commissionRate = platformCommission / 100;

      const commission = Number((dailyCost * commissionRate).toFixed(2));
      const vendorShare = Number((dailyCost - commission).toFixed(2));

      // Deduct locally from locked balance (fallback to available if locked is zero)
      const mongoose = require('mongoose');
      const studentLocked = parseFloat(studentWallet.lockedBalanceKES ? studentWallet.lockedBalanceKES.toString() : '0');
      const studentAvail = parseFloat(studentWallet.availableBalanceKES ? studentWallet.availableBalanceKES.toString() : '0');
      const studentSpent = parseFloat(studentWallet.totalSpentKES ? studentWallet.totalSpentKES.toString() : '0');
      const vendorAvail = parseFloat(vendorWallet.availableBalanceKES ? vendorWallet.availableBalanceKES.toString() : '0');

      if (studentLocked >= dailyCost) {
        studentWallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString((studentLocked - dailyCost).toFixed(2));
      } else if (studentAvail >= dailyCost) {
        studentWallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((studentAvail - dailyCost).toFixed(2));
        studentWallet.totalSpentKES = mongoose.Types.Decimal128.fromString((studentSpent + dailyCost).toFixed(2));
      } else {
        console.warn(`Insufficient student balance for subscription ${sub._id}`);
        continue;
      }
      await studentWallet.save();

      // Credit Vendor locally
      vendorWallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((vendorAvail + vendorShare).toFixed(2));
      await vendorWallet.save();

      // Perform Platform Stellar Settlement
      let stellarTxHash1 = "";
      let stellarTxHash2 = "";
      try {
        stellarTxHash1 = await stellarTreasuryService.releaseVendorSettlement(vendorShare);
        stellarTxHash2 = await stellarTreasuryService.recordRevenue(commission);
      } catch (err) {
        console.error("Stellar daily deduction platform transfer failed. Logged locally:", err.message);
      }

      // Record Transactions
      await Transaction.create({
        transactionId: crypto.randomUUID(),
        fromUser: sub.student._id,
        toUser: meal.vendor,
        amountKES: vendorShare,
        transactionCategory: 'escrow_release',
        paymentMethod: 'stellar',
        orderType: 'subscription',
        stellarTxHash: stellarTxHash1 || null,
        status: 'completed',
        description: `Daily subscription release for ${sub._id}`
      });

      await Transaction.create({
        transactionId: crypto.randomUUID(),
        fromUser: vendorProfile.user, // Vendor pays commission!
        toUser: null, // to Platform/System
        amountKES: commission,
        transactionCategory: 'commission',
        paymentMethod: 'stellar',
        orderType: 'subscription',
        stellarTxHash: stellarTxHash2 || null,
        status: 'completed',
        description: `Daily platform commission (${platformCommission}%) for subscription ${sub._id}`
      });

      // Credit admin wallet for the commission
      await Wallet.updateOne(
        { walletType: 'admin' },
        { $inc: { availableBalanceKES: Number(commission.toFixed(2)) } }
      );

      console.log(`Successfully processed daily deduction of ${dailyCost} KES for subscription ${sub._id}`);

    } catch (error) {
      console.error(`Failed deduction for subscription ${sub._id}:`, error);
    }
  }
};

module.exports = { processDailyDeductions };
