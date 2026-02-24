const User = require('../models/User');
const Meal = require('../models/Meal');
const Wallet = require('../models/Wallet');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');

// @desc    Get system stats
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getDashboard = async (req, res) => {
  try {
    const users = await User.countDocuments();
    const meals = await Meal.countDocuments();
    // Sum of all wallet balances locally tracked
    const wallets = await Wallet.find();
    const totalLiquidity = wallets.reduce((acc, w) => acc + w.balance, 0);

    res.json({
      totalUsers: users,
      totalMeals: meals,
      networkLiquidity: totalLiquidity
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Approve a meal
// @route   POST /api/admin/approve/meal
// @access  Private (Admin)
const approveMeal = async (req, res) => {
  const { mealId, status } = req.body; // status: 'approved' or 'rejected'

  try {
    const meal = await Meal.findById(mealId);
    if (!meal) return res.status(404).json({ message: 'Meal not found' });

    meal.approvalStatus = status;
    await meal.save();

    res.json({ message: `Meal ${status}` });
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

// @desc    Get pending approvals (vendors and meals)
// @route   GET /api/admin/pending
// @access  Private (Admin)
const getPendingApprovals = async (req, res) => {
  try {
    const pendingVendors = await Vendor.find({ approvedStatus: 'pending' }).populate('user', 'name email');
    const pendingMeals = await Meal.find({ approvalStatus: 'pending' }).populate('vendor', 'name');

    res.json({ vendors: pendingVendors, meals: pendingMeals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get all vendors (active, pending, rejected)
// @route   GET /api/admin/vendors
// @access  Private (Admin)
const getVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find().populate('user', 'name email');
    res.json(vendors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get all wallets
// @route   GET /api/admin/wallets
// @access  Private (Admin)
const getWallets = async (req, res) => {
  try {
    const wallets = await Wallet.find().populate('user', 'name email role');
    res.json(wallets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get all transactions
// @route   GET /api/admin/transactions
// @access  Private (Admin)
const getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate({
        path: 'fromWallet',
        populate: { path: 'user', select: 'name email role' }
      })
      .populate({
        path: 'toWallet',
        populate: { path: 'user', select: 'name email role' }
      })
      .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getDashboard,
  approveMeal,
  getUsers,
  getPendingApprovals,
  approveVendor,
  getVendors,
  getWallets,
  getTransactions
};
