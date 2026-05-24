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
      
      const vendorWallet = await Wallet.findOne({ user: meal.vendor });
      if (!vendorWallet) {
        console.error(`Vendor wallet not found for vendor ${meal.vendor}`);
        continue;
      }

      const dailyCost = Number(sub.dailyCost || 0);
      if (dailyCost <= 0) continue;

      // Split cost: 90% Vendor, 10% Platform Revenue Commission
      const commission = Number((dailyCost * 0.10).toFixed(2));
      const vendorShare = Number((dailyCost - commission).toFixed(2));

      // Deduct locally from locked balance (fallback to available if locked is zero)
      if (studentWallet.lockedBalanceKES >= dailyCost) {
        studentWallet.lockedBalanceKES -= dailyCost;
      } else if (studentWallet.availableBalanceKES >= dailyCost) {
        studentWallet.availableBalanceKES -= dailyCost;
        studentWallet.totalSpentKES += dailyCost;
      } else {
        console.warn(`Insufficient student balance for subscription ${sub._id}`);
        continue;
      }
      await studentWallet.save();

      // Credit Vendor locally
      vendorWallet.availableBalanceKES += vendorShare;
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
        fromUser: sub.student._id,
        amountKES: commission,
        transactionCategory: 'commission',
        paymentMethod: 'stellar',
        orderType: 'subscription',
        stellarTxHash: stellarTxHash2 || null,
        status: 'completed',
        description: `Daily platform commission for subscription ${sub._id}`
      });

      console.log(`Successfully processed daily deduction of ${dailyCost} KES for subscription ${sub._id}`);

    } catch (error) {
      console.error(`Failed deduction for subscription ${sub._id}:`, error);
    }
  }
};

module.exports = { processDailyDeductions };
