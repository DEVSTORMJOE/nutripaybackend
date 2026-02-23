const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarService = require('./stellarService');

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily deductions...');
  await processDailyDeductions();
});

const processDailyDeductions = async () => {
  const subscriptions = await Subscription.find({ status: 'active', endDate: { $gte: new Date() } })
    .populate('student')
    .populate('plan');

  for (const sub of subscriptions) {
    try {
      const studentWallet = await Wallet.findOne({ user: sub.student._id });
      const vendorWallet = await Wallet.findOne({ user: sub.plan.vendor }); // Assuming vendor is linked to plan

      if (!studentWallet || !vendorWallet) {
        console.error(`Wallets not found for subscription ${sub._id}`);
        continue;
      }

      // Deduct from Student to Vendor
      // Note: In a real Stellar setup, this needs the student's secret key.
      // Since we stored it (custodial), we can retrieve it.
      const studentSecret = studentWallet.stellarSecretKey;

      if (studentSecret) {
        const tx = await stellarService.makePayment(studentSecret, vendorWallet.stellarPublicKey, sub.dailyCost);

        // Record Transaction
        await Transaction.create({
          fromWallet: studentWallet._id,
          toWallet: vendorWallet._id,
          amount: sub.dailyCost,
          type: 'payment',
          stellarTxHash: tx.hash,
          description: `Daily deduction for ${sub.plan.name}`,
          status: 'completed'
        });

        console.log(`Deducted ${sub.dailyCost} for subscription ${sub._id}`);
      }

    } catch (error) {
      console.error(`Failed deduction for subscription ${sub._id}:`, error);
    }
  }
};

module.exports = { processDailyDeductions };
