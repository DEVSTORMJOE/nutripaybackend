const User = require('../models/User');
const Meal = require('../models/Meal');
const Wallet = require('../models/Wallet');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const stellarService = require('../services/stellarService');

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
    const pendingVendors = await Vendor.find({ approvedStatus: 'pending' }).populate('user', 'name email companyName');
    
    // Deep populate the vendor and its user to properly display the vendor name
    const pendingMeals = await Meal.find({ approvalStatus: 'pending' }).populate({
      path: 'vendor',
      populate: {
        path: 'user',
        select: 'name email companyName'
      }
    });

    res.json({ vendors: pendingVendors, meals: pendingMeals });
  } catch (error) {
    console.error("Pending Approvals Error:", error);
    res.status(500).json({ message: 'Server Error fetching pending approvals' });
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

// @desc    Create a user
// @route   POST /api/admin/users
// @access  Private (Admin)
const createUser = async (req, res) => {
  try {
    const { name, email, password, role, isApproved } = req.body;
    
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      isApproved: isApproved !== undefined ? isApproved : true,
      requiresPasswordChange: true
    });

    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Update a user
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
const updateUser = async (req, res) => {
  try {
    const { name, email, role, isApproved, password } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;
    if (isApproved !== undefined) user.isApproved = isApproved;
    
    if (password) {
      user.password = password;
      user.requiresPasswordChange = true;
    }

    await user.save();
    
    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a vendor
// @route   POST /api/admin/vendors
// @access  Private (Admin)
const createVendor = async (req, res) => {
  try {
    const { name, email, password, approvedStatus } = req.body;
    
    // 1. Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // 2. Create User
    user = await User.create({
      name,
      email,
      password,
      role: 'vendor',
      isApproved: approvedStatus === 'approved' ? true : false,
      requiresPasswordChange: true
    });

    // 3. Create Stellar Wallet
    const keypair = await stellarService.createWallet();
    await Wallet.create({
      user: user._id,
      stellarPublicKey: keypair.publicKey,
      stellarSecretKey: keypair.secret,
      walletType: 'vendor',
      balance: 0
    });

    // 4. Create Vendor Profile
    const vendor = await Vendor.create({
      user: user._id,
      stellarPublicKey: keypair.publicKey,
      approvedStatus: approvedStatus || 'pending'
    });

    res.status(201).json({
      message: 'Vendor created successfully',
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      vendor
    });
  } catch (error) {
    console.error("Vendor Creation Error:", error);
    res.status(500).json({ message: 'Server Error during vendor creation' });
  }
};

// @desc    Get all meals (for Admin portal)
// @route   GET /api/admin/meals
// @access  Private (Admin)
const getMeals = async (req, res) => {
  try {
    const meals = await Meal.find().populate({
      path: 'vendor',
      populate: { path: 'user', select: 'name email' }
    }).sort({ createdAt: -1 });
    res.json(meals);
  } catch (error) {
    console.error("Fetch Meals Error:", error);
    res.status(500).json({ message: 'Server Error fetching meals' });
  }
};

// @desc    Update meal approval status
// @route   PATCH /api/admin/meals/:id/approval
// @access  Private (Admin)
const updateMealApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(approvalStatus)) {
      return res.status(400).json({ message: 'Invalid approval status' });
    }

    const meal = await Meal.findByIdAndUpdate(
      id,
      { approvalStatus },
      { new: true }
    ).populate({
      path: 'vendor',
      populate: { path: 'user', select: 'name email' }
    });

    if (!meal) {
      return res.status(404).json({ message: 'Meal not found' });
    }

    res.json(meal);
  } catch (error) {
    console.error("Update Meal Approval Error:", error);
    res.status(500).json({ message: 'Server Error updating meal approval' });
  }
};

// @desc    Get all orders (deliveries)
// @route   GET /api/admin/orders
// @access  Private (Admin)
const getOrders = async (req, res) => {
  try {
    const orders = await Delivery.find()
      .populate('student', 'name email role')
      .populate({
        path: 'vendor',
        populate: { path: 'user', select: 'name email' }
      })
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error("Admin getting orders failed:", error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// @desc    Get all delivery staff globally
// @route   GET /api/admin/delivery-staff
// @access  Private (Admin)
const getDeliveryStaff = async (req, res) => {
  try {
    // We fetch all users with role 'delivery'
    const drivers = await User.find({ role: 'delivery' }).select('-password').lean();
    
    // We need to resolve which vendor they belong to.
    // Easiest is to fetch all vendors and cross-reference, since drivers are stored inside vendor.deliveryStaff
    const Vendor = require('../models/Vendor');
    const allVendors = await Vendor.find().populate('user', 'name');

    // Build a map of driver ID -> Vendor Name
    const driverVendorMap = {};
    for (const vendor of allVendors) {
      if (vendor.deliveryStaff && vendor.deliveryStaff.length > 0) {
        for (const staffId of vendor.deliveryStaff) {
          driverVendorMap[staffId.toString()] = vendor.user ? vendor.user.name : "Unknown Vendor";
        }
      }
    }

    const mappedDrivers = drivers.map(d => ({
      _id: d._id,
      name: d.name,
      email: d.email,
      phone: d.phone || "Not Provided",
      status: "Available",
      vendorName: driverVendorMap[d._id.toString()] || "No Vendor Assigned"
    }));

    res.json(mappedDrivers);
  } catch (error) {
    console.error("Admin getting delivery staff failed:", error);
    res.status(500).json({ message: 'Failed to fetch delivery staff' });
  }
};

module.exports = {
  getDashboard,
  getUsers,
  createUser,
  updateUser,
  getTransactions,
  createVendor,
  getMeals,
  updateMealApproval,
  approveMeal, // Kept existing functions not explicitly removed
  getPendingApprovals,
  approveVendor,
  getVendors,
  getWallets,
  getOrders,
  getDeliveryStaff,
};
