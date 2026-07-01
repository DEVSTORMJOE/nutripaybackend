const cron = require('node-cron');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');

async function checkPendingStudentWithdrawals() {
  try {
    // 7 days hold period
    const holdPeriodLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find all pending withdrawal requests that are older than 7 days and notification has not been sent yet
    const pendingRequests = await WithdrawalRequest.find({
      status: 'requested',
      notificationSent: { $ne: true },
      createdAt: { $lte: holdPeriodLimit }
    }).populate('user');

    for (const req of pendingRequests) {
      if (req.user && req.user.role === 'student') {
        const studentId = req.user._id;

        // Find student's sponsor. In User, linkedAccounts holds student's sponsor's ID and vice versa.
        // So find sponsor who has this studentId in their linkedAccounts.
        const sponsor = await User.findOne({
          role: 'sponsor',
          linkedAccounts: studentId
        });

        // 1. Send notification to the sponsor
        if (sponsor) {
          await Notification.create({
            user: sponsor._id,
            type: 'sponsorship',
            title: 'Student Withdrawal Hold Ended',
            message: `The 7-day security hold for student ${req.user.name}'s withdrawal of KES ${req.amountKES} has ended. The administrator can now approve the payout.`
          });
          console.log(`[Scheduler] Notification sent to sponsor ${sponsor.email} for student ${req.user.email} withdrawal.`);
        }

        // 2. Send notification to all admins
        const admins = await User.find({ role: 'admin' });
        for (const admin of admins) {
          await Notification.create({
            user: admin._id,
            type: 'wallet',
            title: 'Student Withdrawal Eligible',
            message: `Student ${req.user.name}'s withdrawal request of KES ${req.amountKES} has completed its 7-day hold period and is ready for payout approval.`
          });
        }

        // Mark request notificationSent as true
        req.notificationSent = true;
        await req.save();
        console.log(`[Scheduler] Hold ended notifications dispatched for student withdrawal ${req._id}.`);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking pending student withdrawals:', error);
  }
}

function startWithdrawalScheduler() {
  console.log('[Scheduler] Initializing Student Withdrawal Hold Checker (runs every 60s)...');
  cron.schedule('*/1 * * * *', async () => {
    await checkPendingStudentWithdrawals();
  });
}

module.exports = { startWithdrawalScheduler };
