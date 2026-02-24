const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const stellarService = require('../services/stellarService');

// @desc    Get student dashboard stats
// @route   GET /api/student/dashboard
// @access  Private (Student)
const getDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' }).populate('meal');
    const wallet = await Wallet.findOne({ user: studentId });

    // Fetch deliveries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todaysDeliveries = await Delivery.find({
      student: studentId,
      scheduledDate: { $gte: today, $lte: endOfDay },
    }).sort({ scheduledDate: 1 });

    const todaysDelivery = todaysDeliveries.length > 0 ? todaysDeliveries[0] : null;

    const upcomingDeliveriesCount = await Delivery.countDocuments({
      student: studentId,
      scheduledDate: { $gte: today },
      status: { $in: ['pending', 'assigned'] }
    });

    let balance = wallet ? wallet.balance : 0;

    // Fetch live balance from Stellar Network
    try {
      if (wallet && wallet.stellarPublicKey) {
        const liveXlmBalance = await stellarService.getBalance(wallet.stellarPublicKey);
        if (liveXlmBalance !== null) {
          const liveKesBalance = stellarService.XLM_to_KES(liveXlmBalance);
          
          if (!isNaN(liveKesBalance) && parseFloat(liveKesBalance) >= 0) {
              balance = parseFloat(liveKesBalance);
              wallet.balance = balance;
              await wallet.save();
          }
        }
      }
    } catch (stellarError) {
      console.error("Failed to fetch live Stellar balance, falling back to MongoDB cache:", stellarError);
    }

    res.json({
      balance,
      subscription,
      todaysDelivery,
      upcomingDeliveriesCount,
      walletPublicKey: wallet ? wallet.stellarPublicKey : null
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

// @desc    Opt out of meal
// @route   POST /api/student/opt-out
// @access  Private (Student)
const optOut = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ student: req.user.id, status: 'active' });
    if (!subscription) return res.status(400).json({ message: 'No active subscription' });

    subscription.status = 'cancelled';
    subscription.endDate = Date.now();
    await subscription.save();

    res.json({ message: 'Successfully opted out' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
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
    
    // 1. Fetch the targeted deliveries
    const deliveries = await Delivery.find({
      _id: { $in: deliveryIds },
      student: studentId,
      status: 'pending' // Only allow cancelling pending deliveries
    });

    if (deliveries.length === 0) {
      return res.status(400).json({ message: 'No eligible pending deliveries found to cancel.' });
    }

    // 2. Calculate Refund Total
    let refundKes = 0;
    const validDeliveryIds = [];
    // Assume all deliveries go to the same vendor for this student's schedule
    const vendorId = deliveries[0].vendor; 

    deliveries.forEach(d => {
      refundKes += Number(d.totalCost || 0);
      validDeliveryIds.push(d._id);
    });

    if (refundKes <= 0) {
      // Just cancel them, no money to refund
      await Delivery.updateMany({ _id: { $in: validDeliveryIds } }, { $set: { status: 'cancelled' } });
      return res.json({ message: 'Deliveries cancelled. No refund required.', refunded: 0, count: validDeliveryIds.length });
    }

    // 3. Process Stellar Refund from Escrow (Admin)
    const studentWallet = await Wallet.findOne({ user: studentId });
    const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');

    if (!studentWallet || !adminWallet || !adminWallet.stellarSecretKey) {
      return res.status(500).json({ message: 'Escrow (Admin) wallet information missing. Cannot process refund.' });
    }

    // Transfer from Admin back to Student
    const tx = await stellarService.makePayment(
      adminWallet.stellarSecretKey, 
      studentWallet.stellarPublicKey, 
      refundKes
    );

    // 4. Log Transaction
    await Transaction.create({
      fromWallet: adminWallet._id,
      toWallet: studentWallet._id,
      amount: refundKes,
      type: 'refund',
      stellarTxHash: tx.hash,
      description: `Refund for ${validDeliveryIds.length} cancelled deliveries`,
      status: 'completed'
    });

    // 5. Update local balances
    studentWallet.balance += refundKes;
    await studentWallet.save();

    adminWallet.balance -= refundKes;
    await adminWallet.save();

    // 6. Update Delivery Statuses
    await Delivery.updateMany({ _id: { $in: validDeliveryIds } }, { $set: { status: 'cancelled' } });

    res.json({ 
      message: `Successfully cancelled ${validDeliveryIds.length} deliveries.`, 
      refunded: refundKes, 
      newBalance: studentWallet.balance,
      txHash: tx.hash 
    });

  } catch (error) {
    console.error("Cancel Deliveries Error:", error);
    res.status(500).json({ message: 'Failed to process cancellation and refund: ' + (error.message || 'Unknown network error') });
  }
};

module.exports = {
  getDashboard,
  selectMeal,
  optOut,
  getDeliverySchedule,
  cancelDeliveries
};
