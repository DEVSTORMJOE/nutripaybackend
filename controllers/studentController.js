const MealPlan = require('../models/MealPlan');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');
const stellarService = require('../services/stellarService');

// @desc    Get student dashboard stats
// @route   GET /api/student/dashboard
// @access  Private (Student)
const getDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' }).populate('plan');
    const wallet = await Wallet.findOne({ user: studentId });

    let balance = wallet ? wallet.balance : 0;

    // Fetch live balance from Stellar Network
    try {
      if (wallet && wallet.stellarPublicKey) {
        const liveXlmBalance = await stellarService.getBalance(wallet.stellarPublicKey);
        const liveKesBalance = stellarService.XLM_to_KES(liveXlmBalance);
        
        if (!isNaN(liveKesBalance) && parseFloat(liveKesBalance) >= 0) {
            balance = parseFloat(liveKesBalance);
            wallet.balance = balance;
            await wallet.save();
        }
      }
    } catch (stellarError) {
      console.error("Failed to fetch live Stellar balance, falling back to MongoDB cache:", stellarError);
    }

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
