const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');

// @desc    Get student dashboard stats
// @route   GET /api/student/dashboard
// @access  Private (Student)
const getDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' }).populate('meal');
    const wallet = await walletService.getOrCreateWallet(studentId, 'student');

    // Fetch deliveries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todaysDeliveries = await Delivery.find({
      student: studentId,
      scheduledDate: { $gte: today, $lte: endOfDay },
    }).sort({ scheduledDate: 1 }).lean();

    let todaysDelivery = null;
    if (todaysDeliveries.length > 0) {
      todaysDelivery = {
        ...todaysDeliveries[0],
        items: todaysDeliveries.flatMap(d => d.items)
      };
    }

    const upcomingDeliveriesCount = await Delivery.countDocuments({
      student: studentId,
      scheduledDate: { $gte: today },
      status: { $in: ['pending', 'assigned'] }
    });

    res.json({
      balance: wallet.availableBalanceKES,
      availableBalanceKES: wallet.availableBalanceKES,
      lockedBalanceKES: wallet.lockedBalanceKES,
      subscription,
      todaysDelivery,
      upcomingDeliveriesCount,
      walletPublicKey: null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Select a meal
// @route   POST /api/student/select-meal
// @access  Private (Student)
const selectMeal = async (req, res) => {
  const { mealId, sponsorId } = req.body;

  try {
    const meal = await Meal.findById(mealId);
    if (!meal) return res.status(404).json({ message: 'Meal not found' });

    // Check if already subscribed
    const existing = await Subscription.findOne({ student: req.user.id, status: 'active' });
    if (existing) return res.status(400).json({ message: 'Already subscribed to a meal' });

    const subscription = await Subscription.create({
      student: req.user.id,
      meal: mealId,
      sponsor: sponsorId || null,
      dailyCost: meal.price
    });

    // Link accounts
    if (sponsorId) {
      await User.findByIdAndUpdate(sponsorId, {
        $addToSet: { linkedAccounts: req.user.id }
      });
      await User.findByIdAndUpdate(req.user.id, {
        $addToSet: { linkedAccounts: sponsorId }
      });
    }

    res.status(201).json(subscription);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Opt out of meal subscription and refund pending deliveries and wallet balance
// @route   POST /api/student/opt-out
// @access  Private (Student)
const optOut = async (req, res) => {
  try {
    const studentId = req.user.id;
    const studentWallet = await Wallet.findOne({ user: studentId });
    if (!studentWallet) return res.status(404).json({ message: 'Student wallet not found' });

    // Freeze Wallet to prevent race conditions
    studentWallet.status = 'refund_pending';
    await studentWallet.save();

    const subscription = await Subscription.findOne({ student: studentId, status: 'active' });
    const pendingDeliveries = await Delivery.find({ student: studentId, status: 'pending' });

    // 1. Calculate and refund pending deliveries via Escrow Service (locks Escrow -> Treasury Stellar transaction inside)
    const pendingDeliveryIds = pendingDeliveries.map(d => d._id);
    const refundResult = await escrowService.calculateRefund(pendingDeliveryIds, studentId);

    // 2. Calculate Unused Wallet Balance Refund
    let sponsorId = null;
    if (subscription && subscription.sponsor) {
      sponsorId = subscription.sponsor;
    } else {
      const student = await User.findById(studentId).populate('linkedAccounts');
      if (student && student.linkedAccounts && student.linkedAccounts.length > 0) {
        const potentialSponsor = student.linkedAccounts.find(account => account.role === 'sponsor');
        if (potentialSponsor) sponsorId = potentialSponsor._id;
      }
    }

    let walletRefundToSponsor = 0;
    if (studentWallet.availableBalanceKES > 0 && sponsorId) {
      walletRefundToSponsor = studentWallet.availableBalanceKES;

      // Deduct student, credit sponsor internally (fiat level custodial sync)
      await walletService.debitWallet(
        studentId,
        walletRefundToSponsor,
        'refund',
        'wallet',
        `Refund unused student wallet balance to sponsor: ${sponsorId}`
      );

      await walletService.creditWallet(
        sponsorId,
        walletRefundToSponsor,
        'refund',
        'wallet',
        `Refund of unused sponsored student wallet balance`
      );

      // Notify Sponsor
      const Notification = require('../models/Notification');
      await Notification.create({
        user: sponsorId,
        type: 'system',
        title: 'Sponsorship Refund',
        message: `A sponsored student opted out. Unused student balance of ${walletRefundToSponsor} KES was refunded to your wallet.`
      });
    }

    if (subscription) {
      subscription.status = 'cancelled';
      subscription.endDate = Date.now();
      await subscription.save();
    }

    // Unfreeze Wallet
    studentWallet.status = 'active';
    await studentWallet.save();

    res.json({ 
      message: 'Successfully opted out. Wallets and deliveries updated.', 
      refundedToSponsor: (subscription?.sponsor ? refundResult.refundedKES : 0) + walletRefundToSponsor, 
      refundedToStudent: subscription?.sponsor ? 0 : refundResult.refundedKES 
    });

  } catch (error) {
    console.error("Opt-out error:", error);
    try {
      if (req.user) await Wallet.updateOne({ user: req.user.id }, { $set: { status: 'active' } });
    } catch(e) {}
    res.status(500).json({ message: 'Server Error processing opt-out: ' + error.message });
  }
};

// @desc    Get student's upcoming delivery schedule
// @route   GET /api/student/schedule
// @access  Private (Student)
const getDeliverySchedule = async (req, res) => {
  try {
    const deliveries = await Delivery.find({ student: req.user.id }).sort({ scheduledDate: 1 });
    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Cancel specific scheduled deliveries and get a refund
// @route   POST /api/student/cancel-deliveries
// @access  Private (Student)
const cancelDeliveries = async (req, res) => {
  const { deliveryIds } = req.body;

  if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
    return res.status(400).json({ message: 'No deliveries selected for cancellation.' });
  }

  try {
    const studentId = req.user.id;
    const studentWallet = await Wallet.findOne({ user: studentId });
    if (!studentWallet) return res.status(404).json({ message: 'Student wallet not found' });

    // Freeze Wallet
    studentWallet.status = 'refund_pending';
    await studentWallet.save();

    const refundResult = await escrowService.calculateRefund(deliveryIds, studentId);

    // Unfreeze Wallet
    studentWallet.status = 'active';
    await studentWallet.save();

    res.json({ 
      message: `Successfully cancelled ${deliveryIds.length} deliveries.`,
      refundedKES: refundResult.refundedKES,
      newBalance: studentWallet.availableBalanceKES
    });

  } catch (error) {
    console.error("Cancel Deliveries Error:", error);
    try {
      if (req.user) await Wallet.updateOne({ user: req.user.id }, { $set: { status: 'active' } });
    } catch(e) {}
    res.status(500).json({ message: 'Failed to process cancellation and refund: ' + error.message });
  }
};

module.exports = {
  getDashboard,
  selectMeal,
  optOut,
  getDeliverySchedule,
  cancelDeliveries
};
