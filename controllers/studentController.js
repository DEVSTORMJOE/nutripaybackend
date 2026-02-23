const MealPlan = require('../models/MealPlan');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');

// @desc    Get student dashboard stats
// @route   GET /api/student/dashboard
// @access  Private (Student)
const getDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' }).populate('plan');
    const wallet = await Wallet.findOne({ user: studentId });

    // In a real app, query Stellar for live balance or rely on synced balance
    // For now, assume wallet.balance is kept in sync or query on demand
    // Let's query on demand for accuracy if we had the service, but for now use DB
    const balance = wallet ? wallet.balance : 0;

    res.json({
      balance,
      subscription,
      walletPublicKey: wallet ? wallet.stellarPublicKey : null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Select a meal plan
// @route   POST /api/student/select-plan
// @access  Private (Student)
const selectMealPlan = async (req, res) => {
  const { planId, sponsorId } = req.body;

  try {
    const plan = await MealPlan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    // Check if already subscribed
    const existing = await Subscription.findOne({ student: req.user.id, status: 'active' });
    if (existing) return res.status(400).json({ message: 'Already subscribed to a plan' });

    const subscription = await Subscription.create({
      student: req.user.id,
      plan: planId,
      sponsor: sponsorId || null,
      dailyCost: plan.price
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

// @desc    Opt out of meal plan
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

module.exports = {
  getDashboard,
  selectMealPlan,
  optOut,
  getDeliverySchedule
};
