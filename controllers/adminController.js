const User = require('../models/User');
const MealPlan = require('../models/MealPlan');
const Wallet = require('../models/Wallet');
const Vendor = require('../models/Vendor');

// @desc    Get system stats
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getDashboard = async (req, res) => {
  try {
    const users = await User.countDocuments();
    const plans = await MealPlan.countDocuments();
    // Sum of all wallet balances locally tracked
    const wallets = await Wallet.find();
    const totalLiquidity = wallets.reduce((acc, w) => acc + w.balance, 0);

    res.json({
      totalUsers: users,
      totalPlans: plans,
      networkLiquidity: totalLiquidity
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Approve a meal plan
// @route   POST /api/admin/approve/mealplan
// @access  Private (Admin)
const approveMealPlan = async (req, res) => {
  const { planId, status } = req.body; // status: 'approved' or 'rejected'

  try {
    const plan = await MealPlan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    plan.approvalStatus = status;
    await plan.save();

    res.json({ message: `Plan ${status}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Approve or reject a vendor
// @route   POST /api/admin/approve/vendor
// @access  Private (Admin)
const approveVendor = async (req, res) => {
  const { vendorId, status } = req.body; // status: 'approved' or 'rejected'
  try {
    const vendor = await Vendor.findById(vendorId).populate('user');
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    vendor.approvedStatus = status;
    await vendor.save();

    res.json({ message: `Vendor ${status}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    List all users
// @route   GET /api/admin/users
// @access  Private (Admin)
const getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get pending approvals (vendors and meal plans)
// @route   GET /api/admin/pending
// @access  Private (Admin)
const getPendingApprovals = async (req, res) => {
  try {
    const pendingVendors = await Vendor.find({ approvedStatus: 'pending' }).populate('user', 'name email');
    const pendingPlans = await MealPlan.find({ approvalStatus: 'pending' }).populate('vendor', 'name');

    res.json({ vendors: pendingVendors, mealPlans: pendingPlans });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getDashboard,
  approveMealPlan,
  getUsers,
  getPendingApprovals,
  approveVendor
};
