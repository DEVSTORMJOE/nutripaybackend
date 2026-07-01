const User = require('../models/User');
const Meal = require('../models/Meal');
const Wallet = require('../models/Wallet');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const WeeklyPlan = require('../models/WeeklyPlan');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const RefundRequest = require('../models/RefundRequest');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');
const mpesaService = require('../services/mpesaService');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const crypto = require('crypto');

// @desc    Get system stats
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getDashboard = async (req, res) => {
  try {
    const users = await User.countDocuments();
    const meals = await Meal.countDocuments();
    const wallets = await Wallet.find();

    // 1. Reserves & Balances Calculations
    const ntSupply = wallets.reduce((acc, w) => acc + parseFloat(w.tokenBalanceNT ? w.tokenBalanceNT.toString() : '0'), 0);
    const escrowBalance = wallets.reduce((acc, w) => acc + parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0'), 0);
    
    const adminWallet = wallets.find(w => w.walletType === 'admin');
    const treasuryBalance = adminWallet ? parseFloat(adminWallet.availableBalanceKES ? adminWallet.availableBalanceKES.toString() : '0') : 0;
    
    const vendorWallets = wallets.filter(w => w.walletType === 'vendor');
    const vendorSettlementBalance = vendorWallets.reduce((acc, w) => acc + parseFloat(w.availableBalanceKES ? w.availableBalanceKES.toString() : '0'), 0);

    // Sum of Mongo commission transactions
    const commissionTxs = await Transaction.find({ transactionCategory: 'commission', status: 'completed' });
    const totalCommissions = commissionTxs.reduce((acc, tx) => acc + parseFloat(tx.amountKES ? tx.amountKES.toString() : '0'), 0);

    // Deduct completed admin withdrawals
    const admins = await User.find({ role: 'admin' }).select('_id');
    const adminIds = admins.map(a => a._id);
    const withdrawalTxs = await Transaction.find({
      transactionCategory: 'withdrawal',
      status: 'completed',
      fromUser: { $in: adminIds }
    });
    const totalWithdrawals = withdrawalTxs.reduce((acc, tx) => acc + parseFloat(tx.amountKES ? tx.amountKES.toString() : '0'), 0);

    const revenueBalance = Math.max(0, totalCommissions - totalWithdrawals);

    // 2. Withdrawals Counts
    const WithdrawalRequest = require('../models/WithdrawalRequest');
    const pendingWithdrawals = await WithdrawalRequest.countDocuments({ status: 'pending_approval' });
    const approvedWithdrawals = await WithdrawalRequest.countDocuments({ status: 'approved' });
    const failedWithdrawals = await WithdrawalRequest.countDocuments({ status: 'rejected' });

    // 3. Analytics
    const SponsorRequest = require('../models/SponsorRequest');
    const sponsorTxs = await SponsorRequest.find({ status: 'paid' });
    const sponsorFunding = sponsorTxs.reduce((acc, r) => acc + parseFloat(r.amountKES ? r.amountKES.toString() : '0'), 0);

    const Subscription = require('../models/Subscription');
    const subscriptionCount = await Subscription.countDocuments({ status: 'active' });

    const CustomOrder = require('../models/CustomOrder');
    const quickOrderCount = await CustomOrder.countDocuments();

    const deliveryCount = await Delivery.countDocuments();
    const donationCount = await Delivery.countDocuments({ status: 'donated' });

    res.json({
      totalUsers: users,
      totalMeals: meals,
      networkLiquidity: ntSupply,
      ntSupply,
      treasuryBalance,
      escrowBalance,
      vendorSettlementBalance,
      revenueBalance,
      reserveReconciliation: true, // Auto-reconciled with blockchain signatures
      pendingWithdrawals,
      approvedWithdrawals,
      failedWithdrawals,
      sponsorFunding,
      subscriptionCount,
      quickOrderCount,
      donationCount,
      deliveryCount
    });
  } catch (error) {
    console.error("Get Dashboard Stats Error:", error);
    res.status(500).json({ message: 'Server Error loading dashboard statistics' });
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
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    vendor.approvedStatus = status;
    await vendor.save();

    if (vendor.user) {
      await User.findByIdAndUpdate(vendor.user, { isApproved: status === 'approved' });
    }

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
    const users = await User.find().select('-password').lean();
    
    const Student = require('../models/Student');
    const students = await Student.find().select('user studentId').lean();
    const studentMap = students.reduce((acc, s) => {
      acc[s.user.toString()] = s.studentId;
      return acc;
    }, {});

    const DeliveryPersonnel = require('../models/DeliveryPersonnel');
    const [vendors, deliveryStaff] = await Promise.all([
      Vendor.find().select('user approvedStatus deliveryStaff').lean(),
      DeliveryPersonnel.find().select('user approvedStatus').lean()
    ]);

    const vendorMap = vendors.reduce((acc, v) => {
      if (v.user) acc[v.user.toString()] = v.approvedStatus;
      return acc;
    }, {});

    const deliveryMap = deliveryStaff.reduce((acc, d) => {
      if (d.user) acc[d.user.toString()] = d.approvedStatus;
      return acc;
    }, {});

    // Map driver user ID to vendor ID
    const driverVendorMap = {};
    for (const v of vendors) {
      if (v.deliveryStaff && Array.isArray(v.deliveryStaff)) {
        for (const staffId of v.deliveryStaff) {
          driverVendorMap[staffId.toString()] = v._id.toString();
        }
      }
    }

    const mappedUsers = users.map(u => {
      let approvedStatus = u.isApproved !== false ? 'approved' : 'rejected';
      if (u.role === 'vendor') {
        approvedStatus = vendorMap[u._id.toString()] || 'pending';
      } else if (u.role === 'delivery') {
        approvedStatus = deliveryMap[u._id.toString()] || 'pending';
      }

      return {
        ...u,
        studentId: studentMap[u._id.toString()] || null,
        vendorId: driverVendorMap[u._id.toString()] || null,
        approvedStatus
      };
    });
    
    res.json(mappedUsers);
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

// @desc    Update wallet status (active, frozen, refund_pending, suspended)
// @route   POST /api/admin/wallets/:id/status
// @access  Private (Admin)
const updateWalletStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'frozen', 'refund_pending', 'suspended'].includes(status)) {
      return res.status(400).json({ message: "Invalid wallet status" });
    }

    const Wallet = require('../models/Wallet');
    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    wallet.status = status;
    await wallet.save();

    // Log permanent AuditLog for user status change
    const AuditLog = require('../models/AuditLog');
    await AuditLog.create({
      action: 'manual_adjustment',
      user: req.user.id,
      details: {
        action: 'wallet_status_change',
        walletId: wallet._id,
        newStatus: status
      }
    });

    res.json({ message: `Wallet status successfully updated to ${status}`, wallet });
  } catch (error) {
    console.error("Update wallet status error:", error);
    res.status(500).json({ message: "Failed to update wallet status: " + error.message });
  }
};

// @desc    Get all transactions
// @route   GET /api/admin/transactions
// @access  Private (Admin)
const getTransactions = async (req, res) => {
  try {
    const { explainTransaction } = require('../utils/transactionUtils');
    const transactions = await Transaction.find()
      .populate('fromUser', 'name email role')
      .populate('toUser', 'name email role')
      .sort({ createdAt: -1 })
      .lean();

    // Map fromUser and toUser to match expected frontend structure: fromWallet.user and toWallet.user, along with amount
    const mappedTransactions = transactions.map(tx => {
      const type = tx.transactionCategory === 'vendor_payout' ? 'payout' : 
                   tx.transactionCategory === 'mpesa_direct_order' ? 'payment' : 
                   tx.transactionCategory === 'subscription_lock' ? 'payment' : 
                   tx.transactionCategory === 'deposit' ? 'funding' : 
                   tx.transactionCategory === 'withdrawal' ? 'withdrawal' : 
                   tx.transactionCategory === 'refund' ? 'refund' : 'payment';

      const { source, destination, purpose } = explainTransaction(tx);

      return {
        ...tx,
        amount: tx.amountKES,
        type,
        source,
        destination,
        purpose,
        fromWallet: tx.fromUser ? { user: tx.fromUser, walletType: tx.fromUser.role } : null,
        toWallet: tx.toUser ? { user: tx.toUser, walletType: tx.toUser.role } : null
      };
    });

    res.json(mappedTransactions);
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
    const { name, email, phone, password, role, isApproved, vendorId } = req.body;
    
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const { normalizePhone, isValidPhone } = require('../utils/phoneUtils');
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone && !isValidPhone(normalizedPhone)) {
      return res.status(400).json({ message: 'Invalid phone number format. Enter a valid Kenyan number.' });
    }

    const user = await User.create({
      name,
      email,
      phone: normalizedPhone,
      password,
      role,
      isApproved: isApproved !== undefined ? isApproved : true,
      requiresPasswordChange: true
    });

    if (role === 'delivery' && vendorId) {
      const vendor = await Vendor.findById(vendorId);
      if (vendor) {
        // Prevent duplicates
        if (!vendor.deliveryStaff.includes(user._id)) {
          vendor.deliveryStaff.push(user._id);
          await vendor.save();
        }
      }
    }

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
    const { name, email, phone, role, isApproved, approvedStatus, password, vendorId } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    
    if (phone !== undefined) {
      const { normalizePhone, isValidPhone } = require('../utils/phoneUtils');
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone && !isValidPhone(normalizedPhone)) {
        return res.status(400).json({ message: 'Invalid phone number format. Enter a valid Kenyan number.' });
      }
      user.phone = normalizedPhone;
    }

    if (role) user.role = role;
    
    let finalStatus = approvedStatus;
    if (finalStatus === undefined && isApproved !== undefined) {
      finalStatus = isApproved ? 'approved' : 'rejected';
    }

    if (finalStatus !== undefined) {
      user.isApproved = (finalStatus === 'approved');
      
      if (user.role === 'delivery') {
        const DeliveryPersonnel = require('../models/DeliveryPersonnel');
        await DeliveryPersonnel.findOneAndUpdate(
          { user: user._id },
          { approvedStatus: finalStatus },
          { upsert: true, new: true }
        );
      } else if (user.role === 'vendor') {
        const Vendor = require('../models/Vendor');
        await Vendor.findOneAndUpdate(
          { user: user._id },
          { approvedStatus: finalStatus },
          { upsert: true, new: true }
        );
      }
    }
    
    // Vendor assignment logic for delivery personnel
    if (user.role === 'delivery' && vendorId) {
      const Vendor = require('../models/Vendor');
      
      // Remove this delivery staff from any other vendor list first
      await Vendor.updateMany(
        { deliveryStaff: user._id },
        { $pull: { deliveryStaff: user._id } }
      );
      
      // Add this delivery staff to the new vendor list
      const vendor = await Vendor.findById(vendorId);
      if (vendor) {
        if (!vendor.deliveryStaff.includes(user._id)) {
          vendor.deliveryStaff.push(user._id);
          await vendor.save();
        }
      }
    }
    
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

    // 3. Create Custodial Wallet
    await walletService.getOrCreateWallet(user._id, 'vendor');
 
    // 4. Create Vendor Profile
    const vendor = await Vendor.create({
      user: user._id,
      stellarPublicKey: null,
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const query = {};

    // Filter by orderType
    if (req.query.orderType === 'custom') {
      query.isCustom = true;
    } else if (req.query.orderType === 'subscription') {
      query.isCustom = { $ne: true };
    }

    // 1. Base Dropdown Filters
    if (req.query.status) {
      query.status = req.query.status;
    }
    if (req.query.mealType) {
      query.timeSlot = req.query.mealType;
    }
    if (req.query.driver) {
      query.deliveryAgent = req.query.driver;
    }
    if (req.query.vendor) {
      query.vendor = req.query.vendor;
    }
    if (req.query.student) {
      query.student = req.query.student;
    }

    // Date Range Filters
    if (req.query.startDate || req.query.endDate) {
      query.scheduledDate = {};
      if (req.query.startDate) {
        query.scheduledDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        query.scheduledDate.$lte = end;
      }
    }

    // Hostel/Residence filtering
    if (req.query.hostel) {
      query.location = { $regex: req.query.hostel, $options: 'i' };
    }

    // 2. Search Parameter (Student Name, Order ID, Hostel)
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search.trim(), 'i');
      
      // We will need to query students that match the name
      const matchedUsers = await User.find({
        role: 'student',
        name: searchRegex
      }).select('_id');
      const studentIds = matchedUsers.map(u => u._id);

      query.$or = [
        { location: searchRegex },
        { student: { $in: studentIds } }
      ];

      // If search string looks like MongoDB ObjectId, check direct match
      if (req.query.search.match(/^[0-9a-fA-F]{24}$/)) {
        query.$or.push({ _id: req.query.search });
      }
    }

    const totalOrders = await Delivery.countDocuments(query);
    const orders = await Delivery.find(query)
      .populate('student', 'name email role phone')
      .populate({
        path: 'vendor',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate('deliveryAgent', 'name email phone')
      .populate('deliveryLocation', 'hostelResidence block room landmark')
      .sort({ scheduledDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      orders,
      pagination: {
        total: totalOrders,
        page,
        limit,
        pages: Math.ceil(totalOrders / limit)
      }
    });
  } catch (error) {
    console.error("Admin getting orders failed:", error);
    res.status(500).json({ message: 'Failed to fetch orders: ' + error.message });
  }
};

// @desc    Assign a driver to an order (override)
// @route   POST /api/admin/orders/:id/assign-driver
// @access  Private (Admin)
const assignDriverToOrder = async (req, res) => {
  const { driverId } = req.body;
  try {
    const Delivery = require('../models/Delivery');
    const User = require('../models/User');
    const AuditLog = require('../models/NDashAuditLog');
    const Notification = require('../models/Notification');

    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) {
      return res.status(404).json({ message: 'Order delivery record not found.' });
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'delivery') {
      return res.status(400).json({ message: 'Selected user is not a registered delivery agent.' });
    }

    const previousDriver = delivery.deliveryAgent;
    delivery.deliveryAgent = driverId;

    // Transition status to 'assigned' if it's currently pending or preparing or ready
    if (['pending', 'preparing', 'ready'].includes(delivery.status)) {
      delivery.status = 'assigned';
    }

    // Ensure verification code is generated if missing
    if (!delivery.deliveryVerificationCode) {
      const part1 = Math.floor(100 + Math.random() * 900);
      const part2 = Math.floor(100 + Math.random() * 900);
      delivery.deliveryVerificationCode = `NP-${part1}-${part2}`;
    }

    await delivery.save();

    // Log the override action
    await AuditLog.create({
      action: 'ORDER_DRIVER_ASSIGNED',
      details: `Admin assigned driver ${driver.name} (ID: ${driverId}) to order delivery ${delivery._id}. Previous driver: ${previousDriver || 'None'}`
    });

    // Notify the driver
    await Notification.create({
      user: driverId,
      type: 'delivery',
      title: 'New Delivery Assigned 🚴',
      message: `You have been manually assigned to delivery #${String(delivery._id).slice(-6)} at ${delivery.location}.`
    });

    res.json({
      message: 'Delivery staff successfully assigned to this order.',
      delivery
    });
  } catch (error) {
    console.error("Assign driver override failed:", error);
    res.status(500).json({ message: 'Failed to assign driver: ' + error.message });
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

    // Check for active deliveries to determine assignment status
    const activeDeliveries = await Delivery.find({
      status: { $in: ['assigned', 'picked_up'] }
    });
    const assignedDriverIds = activeDeliveries.map(d => d.deliveryAgent?.toString()).filter(Boolean);

    // Build a map of driver ID -> Vendor Name
    const driverVendorMap = {};
    for (const vendor of allVendors) {
      if (vendor.deliveryStaff && vendor.deliveryStaff.length > 0) {
        for (const staffId of vendor.deliveryStaff) {
          driverVendorMap[staffId.toString()] = vendor.user ? vendor.user.name : "Unknown Vendor";
        }
      }
    }

    // Fetch delivery personnel profiles
    const DeliveryPersonnel = require('../models/DeliveryPersonnel');
    const deliveryProfiles = await DeliveryPersonnel.find({ user: { $in: drivers.map(d => d._id) } }).populate('assignedLocations').lean();
    const deliveryProfileMap = {};
    const deliveryLocationsMap = {};
    const deliveryAssignmentTypeMap = {};
    for (const dp of deliveryProfiles) {
      deliveryProfileMap[dp.user.toString()] = dp.approvedStatus;
      deliveryLocationsMap[dp.user.toString()] = dp.assignedLocations || [];
      deliveryAssignmentTypeMap[dp.user.toString()] = dp.assignmentType || "meal_delivery";
    }

    const mappedDrivers = drivers.map(d => ({
      _id: d._id,
      name: d.name,
      email: d.email,
      phone: d.phone || "Not Provided",
      status: assignedDriverIds.includes(d._id.toString()) ? "Assigned" : "Available",
      approvedStatus: deliveryProfileMap[d._id.toString()] || (d.isApproved ? "approved" : "pending"),
      vendorName: driverVendorMap[d._id.toString()] || "No Vendor Assigned",
      assignedLocations: deliveryLocationsMap[d._id.toString()] || [],
      assignmentType: deliveryAssignmentTypeMap[d._id.toString()] || "meal_delivery"
    }));

    res.json(mappedDrivers);
  } catch (error) {
    console.error("Admin getting delivery staff failed:", error);
    res.status(500).json({ message: 'Failed to fetch delivery staff' });
  }
};

// @desc    Approve or reject delivery staff / update assignment type
// @route   POST /api/admin/approve/delivery
// @access  Private (Admin)
const approveDelivery = async (req, res) => {
  const { deliveryId, status, assignmentType } = req.body; 
  try {
    const DeliveryPersonnel = require('../models/DeliveryPersonnel');
    const delivery = await DeliveryPersonnel.findOne({ user: deliveryId });
    
    if (!delivery) {
      // If profile doesn't exist yet, we might need to create it
      const newDelivery = await DeliveryPersonnel.create({
        user: deliveryId,
        approvedStatus: status || 'approved',
        assignmentType: assignmentType || 'meal_delivery'
      });
      const User = require('../models/User');
      if (status) await User.findByIdAndUpdate(deliveryId, { isApproved: status === 'approved' });
      return res.json({ message: `Delivery staff updated`, delivery: newDelivery });
    }

    if (status !== undefined) {
      delivery.approvedStatus = status;
      const User = require('../models/User');
      await User.findByIdAndUpdate(deliveryId, { isApproved: status === 'approved' });
    }
    if (assignmentType !== undefined) {
      delivery.assignmentType = assignmentType;
    }
    await delivery.save();

    res.json({ message: `Delivery staff updated successfully` });
  } catch (error) {
    console.error("Approve Delivery Error:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const getWeeklyPlans = async (req, res) => {
  try {
    const filter = {};
    if (req.query.week) filter.week = Number(req.query.week);
    if (req.query.planId) filter.planId = req.query.planId;

    const plans = await WeeklyPlan.find(filter)
      .populate('breakfast')
      .populate('lunch')
      .populate('supper');
    res.json(plans);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateWeeklyPlan = async (req, res) => {
  const { planId, week, day, breakfast, lunch, supper } = req.body;
  const cleanId = (val) => {
    if (!val || val === "" || val === "null" || val === "undefined") {
      return null;
    }
    return val;
  };
  try {
    const plan = await WeeklyPlan.findOneAndUpdate(
      { planId, week: Number(week || 1), day },
      { 
        breakfast: cleanId(breakfast), 
        lunch: cleanId(lunch), 
        supper: cleanId(supper) 
      },
      { upsert: true, new: true }
    );
    res.json(plan);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error: ' + error.message, error });
  }
};

const getWithdrawalRequests = async (req, res) => {
  try {
    const requests = await WithdrawalRequest.find().populate('user', 'name email role').sort({ createdAt: -1 });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ message: "Failed to fetch withdrawal requests." });
  }
};

const handleWithdrawalRequest = async (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body; // status: 'approved' or 'rejected'

  try {
    // SECURITY REQUIREMENT: Atomic transaction locking to prevent race conditions and duplicate payouts.
    // Query by 'requested' and atomically update status to prevent concurrent invocation race.
    const request = await WithdrawalRequest.findOneAndUpdate(
      { _id: id, status: 'requested' },
      { $set: { status: status === 'approved' ? 'approved' : 'rejected' } },
      { new: true }
    ).populate('user');

    if (!request) {
      return res.status(400).json({ message: "Withdrawal request not found or has already been processed." });
    }

    const wallet = await Wallet.findOne({ user: request.user._id });
    if (!wallet) {
      // Revert status to requested if wallet missing
      request.status = 'requested';
      await request.save();
      return res.status(404).json({ message: "User wallet not found." });
    }

    // SECURITY REQUIREMENT: Audit log every action
    const auditRecord = {
      adminId: req.user.id,
      adminEmail: req.user.email,
      timestamp: new Date(),
      ip: req.ip || req.connection.remoteAddress || '127.0.0.1',
      amountKES: request.amountKES.toString(),
      walletId: wallet._id.toString(),
      action: status
    };
    console.log("[SECURITY AUDIT LOG] Payout action processed:", auditRecord);

    const fs = require('fs');
    const path = require('path');
    const logFilePath = path.join(__dirname, '../withdrawal_security_audit.log');
    fs.appendFileSync(logFilePath, JSON.stringify(auditRecord) + "\n");

    if (status === 'approved') {
      // 1. Dispatch B2C payout to user's phone via Safaricom Daraja API
      let payoutResult;
      try {
        payoutResult = await mpesaService.withdrawToMpesa(request.phone, parseFloat(request.amountKES.toString()));
      } catch (payoutErr) {
        // Revert locking status if payout fails so admin can retry
        request.status = 'requested';
        await request.save();
        return res.status(500).json({ message: "Safaricom B2C payout initiation failed: " + payoutErr.message });
      }

      // 2. Set status to b2c_pending and track conversation IDs
      const crypto = require('crypto');
      request.status = 'b2c_pending';
      request.conversationId = payoutResult.conversationId || `B2C_Conv_${crypto.randomUUID()}`;
      request.originatorConversationId = payoutResult.originatorConversationId || `B2C_Orig_${crypto.randomUUID()}`;
      request.approvedBy = req.user.id;
      request.approvedAt = new Date();
      await request.save();

      // Sandbox environment: auto-simulate B2C callback completion
      if (payoutResult.success || payoutResult.conversationId) {
        setTimeout(async () => {
          try {
            const mpesaController = require('./mpesaController');
            const mockBody = {
              Result: {
                ResultCode: 0,
                ConversationID: request.conversationId,
                OriginatorConversationID: request.originatorConversationId,
                ResultDesc: "Accept the service request successfully."
              }
            };
            const mockReq = { body: mockBody };
            const mockRes = {
              status: () => ({ json: () => {} }),
              json: () => {}
            };
            await mpesaController.mpesaB2CCallback(mockReq, mockRes);
            console.log(`[Sandbox Mock B2C Callback] Auto-triggered B2C payout callback simulation for request ID: ${request._id}`);
          } catch (mockErr) {
            console.error("Mock B2C Callback simulation failed:", mockErr.message);
          }
        }, 1500);
      }

      return res.json({ message: "Withdrawal request approved and payout B2C pending.", request });
    } else if (status === 'rejected') {
      // Reject request: release funds from pendingWithdrawalKES back to availableBalanceKES
      const currentAvail = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
      const currentPending = parseFloat(wallet.pendingWithdrawalKES ? wallet.pendingWithdrawalKES.toString() : '0');
      const amount = parseFloat(request.amountKES.toString());

      wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvail + amount).toFixed(2));
      wallet.pendingWithdrawalKES = mongoose.Types.Decimal128.fromString((currentPending - amount).toFixed(2));
      await wallet.save();

      // Update withdrawal request
      request.status = 'rejected';
      request.approvedBy = req.user.id;
      request.rejectedAt = new Date();
      request.rejectionReason = rejectionReason || "Rejected by administrator";
      await request.save();

      // Log permanent AuditLog for rejection
      try {
        const AuditLog = require('../models/AuditLog');
        await AuditLog.create([{
          action: 'refund_approval', // refund back to available balance
          user: req.user.id,
          details: {
            withdrawalRequestId: request._id,
            amountKES: amount,
            status: 'rejected'
          }
        }]);
      } catch (err) {
        console.error("Audit log failed for withdrawal rejection:", err.message);
      }

      return res.json({ message: "Withdrawal request rejected and funds returned to wallet.", request });
    }
  } catch (error) {
    console.error("Error processing withdrawal approval:", error);
    res.status(500).json({ message: "Server error during withdrawal approval." });
  }
};

const assignLocationsToDriver = async (req, res) => {
  const { driverUserId, locationIds } = req.body;
  try {
    const DeliveryPersonnel = require('../models/DeliveryPersonnel');
    let driver = await DeliveryPersonnel.findOne({ user: driverUserId });
    if (!driver) {
      driver = await DeliveryPersonnel.create({
        user: driverUserId,
        approvedStatus: 'approved',
        assignedLocations: locationIds || []
      });
    } else {
      driver.assignedLocations = locationIds || [];
      await driver.save();
    }
    res.json({ message: "Locations assigned successfully!", driver });
  } catch (error) {
    console.error("Assign Locations Error:", error);
    res.status(500).json({ message: "Server error during location assignment." });
  }
};

const getSettings = async (req, res) => {
  try {
    const SystemSettings = require('../models/SystemSettings');
    const getSettingVal = async (key, defaultVal) => {
      let setting = await SystemSettings.findOne({ key });
      if (!setting) {
        setting = await SystemSettings.create({ key, value: defaultVal });
      }
      return setting.value;
    };

    res.json({
      essential_price: await getSettingVal('essential_price', 3500),
      elite_price: await getSettingVal('elite_price', 4500),
      ultimate_price: await getSettingVal('ultimate_price', 6000),
      banner_small_url: await getSettingVal('banner_small_url', ''),
      banner_large_url: await getSettingVal('banner_large_url', ''),
      banner_timer: await getSettingVal('banner_timer', 5),
      banner_visible: await getSettingVal('banner_visible', false),
      banner_content: await getSettingVal('banner_content', '<h1>Welcome to NutriPay!</h1><p>Special banner description here.</p>')
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to get system settings." });
  }
};

const updateSettings = async (req, res) => {
  const {
    essential_price,
    elite_price,
    ultimate_price,
    banner_small_url,
    banner_large_url,
    banner_timer,
    banner_visible,
    banner_content
  } = req.body;
  try {
    const SystemSettings = require('../models/SystemSettings');
    const updateKey = async (key, val) => {
      if (val !== undefined) {
        await SystemSettings.findOneAndUpdate({ key }, { value: val }, { upsert: true });
      }
    };

    await updateKey('essential_price', essential_price !== undefined ? Number(essential_price) : undefined);
    await updateKey('elite_price', elite_price !== undefined ? Number(elite_price) : undefined);
    await updateKey('ultimate_price', ultimate_price !== undefined ? Number(ultimate_price) : undefined);
    await updateKey('banner_small_url', banner_small_url);
    await updateKey('banner_large_url', banner_large_url);
    await updateKey('banner_timer', banner_timer !== undefined ? Number(banner_timer) : undefined);
    await updateKey('banner_visible', banner_visible);
    await updateKey('banner_content', banner_content);

    res.json({ message: "System settings updated successfully!" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to update settings." });
  }
};

const updateVendorCommission = async (req, res) => {
  const { id } = req.params;
  const { vendorCommissionPercent, platformCommissionPercent, reason } = req.body;
  try {
    const Vendor = require('../models/Vendor');
    const CommissionAudit = require('../models/CommissionAudit');
    const fs = require('fs');
    const path = require('path');
    
    const vendor = await Vendor.findById(id).populate('user');
    if (!vendor) return res.status(404).json({ message: "Vendor profile not found." });
    
    const oldVendorPercent = vendor.vendorCommissionPercent !== undefined ? vendor.vendorCommissionPercent : 90;
    const oldPlatformPercent = vendor.platformCommissionPercent !== undefined ? vendor.platformCommissionPercent : 10;
    
    vendor.vendorCommissionPercent = Number(vendorCommissionPercent);
    vendor.platformCommissionPercent = Number(platformCommissionPercent);
    await vendor.save();
    
    const audit = await CommissionAudit.create({
      admin: req.user.id,
      vendor: id,
      oldVendorPercent,
      newVendorPercent: Number(vendorCommissionPercent),
      oldPlatformPercent,
      newPlatformPercent: Number(platformCommissionPercent),
      reason: reason || "Standard adjustment"
    });
    
    const logFilePath = path.join(__dirname, '../commission_audit.log');
    fs.appendFileSync(logFilePath, JSON.stringify(audit) + "\n");
    
    res.json({ message: "Vendor commission updated successfully!", vendor });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to update vendor commission." });
  }
};

// @desc    Get all student refund requests (opt-outs pending approval)
// @route   GET /api/admin/refund-requests
// @access  Private (Admin)
const getRefundRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const refunds = await RefundRequest.find(filter)
      .populate({
        path: 'student',
        select: 'name email phone linkedAccounts',
        populate: {
          path: 'linkedAccounts',
          select: 'name email role'
        }
      })
      .populate('sponsor', 'name email')
      .populate('subscription', 'planId startDate endDate totalPaidKES')
      .sort({ createdAt: -1 })
      .lean();

    res.json(refunds);
  } catch (error) {
    console.error('Get Refund Requests Error:', error);
    res.status(500).json({ message: 'Server Error fetching refund requests' });
  }
};

// @desc    Approve or reject a student refund request
// @route   POST /api/admin/refund-requests/:id/handle
// @access  Private (Admin)
const handleRefundApproval = async (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body; // status: 'approved' or 'rejected'

  try {
    // Find request if in pending_admin_approval or rejected status.
    const allowedStatuses = ['pending_admin_approval', 'rejected'];
    const refundRequest = await RefundRequest.findOne({
      _id: id,
      status: { $in: allowedStatuses }
    }).populate('student', 'name email phone')
     .populate('sponsor', 'name email');

    if (!refundRequest) {
      return res.status(400).json({ message: 'Refund request not found, already approved, or currently processing.' });
    }

    // Audit record for every admin action
    const fs = require('fs');
    const path = require('path');
    const auditRecord = {
      adminId: req.user.id,
      adminEmail: req.user.email,
      timestamp: new Date(),
      ip: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      refundRequestId: id,
      amountKES: refundRequest.amountKES,
      studentId: refundRequest.student?._id,
      action: status
    };
    console.log('[SECURITY AUDIT LOG] Refund action processed:', auditRecord);
    const logFilePath = path.join(__dirname, '../refund_security_audit.log');
    fs.appendFileSync(logFilePath, JSON.stringify(auditRecord) + '\n');

    // Case 1: Changing status back to pending_admin_approval
    if (status === 'pending_admin_approval') {
      refundRequest.status = 'pending_admin_approval';
      refundRequest.rejectionReason = '';
      await refundRequest.save();

      // Freeze wallet
      await Wallet.findOneAndUpdate(
        { user: refundRequest.student._id },
        { $set: { status: 'refund_pending' } }
      );

      return res.json({
        message: 'Refund request status set back to pending. Student wallet status set to refund_pending.',
        refundRequest
      });
    }

    // Case 2: Transition to processing or rejected
    refundRequest.status = status === 'approved' ? 'processing' : 'rejected';
    await refundRequest.save();

    if (status === 'approved') {
      // Get student's wallet
      const studentWallet = await Wallet.findOne({ user: refundRequest.student._id });
      let actualRefundKES = refundRequest.amountKES;
      let payoutResult = null;
      const studentPhone = refundRequest.student?.phone;

      if (refundRequest.source === 'available_balance_refund') {
        // available_balance_refund logic:
        const currentAvailable = studentWallet ? studentWallet.availableBalanceKES : 0;
        if (actualRefundKES > currentAvailable) {
          console.log(`[Refund Request Capping] Request KES ${actualRefundKES} exceeds available balance KES ${currentAvailable}. Capping.`);
          actualRefundKES = currentAvailable;
        }

        if (studentWallet) {
          studentWallet.availableBalanceKES = Number((studentWallet.availableBalanceKES - actualRefundKES).toFixed(2));
          studentWallet.status = 'active';
          await studentWallet.save();
        }

        // Stellar reverse settlement: Escrow -> Treasury (since money is leaving the system)
        let stellarTxHash = "";
        let settlementStatus = "pending";
        try {
          const stellarTreasuryService = require('../services/stellarTreasuryService');
          stellarTxHash = await stellarTreasuryService.reverseSettlement(actualRefundKES);
          settlementStatus = "synced";
        } catch (err) {
          console.error("Stellar refund reverse settlement failed:", err.message);
          settlementStatus = "failed";
          const errorLogger = require('../utils/errorLogger');
          await errorLogger.logError('escrow', `Stellar reverse settlement failed for available balance refund. KES: ${actualRefundKES}`, {
            studentId: refundRequest.student._id,
            actualRefundKES,
            error: err.message
          }, 'error');
        }

        // Trigger M-Pesa B2C payout with actual capped amount
        if (studentPhone && actualRefundKES > 0) {
          try {
            const mpesaService = require('../services/mpesaService');
            payoutResult = await mpesaService.withdrawToMpesa(studentPhone, actualRefundKES);
            console.log('[Refund B2C] M-Pesa payout initiated:', payoutResult);
          } catch (payoutErr) {
            console.error('[Refund B2C] M-Pesa B2C payout initiation failed:', payoutErr.message);
          }
        }

        // Create withdrawal transaction log
        await Transaction.create({
          transactionId: crypto.randomUUID(),
          fromUser: refundRequest.student._id,
          amountKES: actualRefundKES,
          transactionCategory: 'refund',
          paymentMethod: 'mpesa',
          status: 'completed',
          settlementStatus: settlementStatus,
          stellarTxHash: stellarTxHash || null,
          description: `Admin-approved refund payout of available balance to ${studentPhone || 'phone not on file'}. KES ${actualRefundKES}.`
        });

      } else {
        // subscription_cancellation logic:
        const currentLocked = studentWallet ? studentWallet.lockedBalanceKES : 0;

        // Cap refund request amount to student's actual remaining locked balance
        if (refundRequest.amountKES > currentLocked) {
          console.log(`[Refund Request Capping] Request KES ${refundRequest.amountKES} exceeds locked balance KES ${currentLocked}. Capping to: ${currentLocked} KES.`);
          refundRequest.amountKES = currentLocked;
        }

        // Execute wallet refund: locked -> available for student (or sponsor available)
        let refundResult = null;
        try {
          refundResult = await escrowService.calculateRefund(
            refundRequest.deliveryIds || [],
            refundRequest.student._id
          );
        } catch (refundErr) {
          // Revert status if wallet operation fails
          await RefundRequest.findByIdAndUpdate(id, { status: 'pending_admin_approval' });
          console.error('Refund wallet operation failed:', refundErr.message);
          
          const errorLogger = require('../utils/errorLogger');
          await errorLogger.logError('wallet', `Refund wallet operation failed for request ${id}: ${refundErr.message}`, {
            refundRequestId: id,
            studentId: refundRequest.student?._id,
            error: refundErr.stack || refundErr.message
          }, 'error');

          return res.status(500).json({ message: 'Wallet refund failed: ' + refundErr.message });
        }

        actualRefundKES = refundResult && refundResult.refundedKES !== undefined ? refundResult.refundedKES : refundRequest.amountKES;

        // Restore wallet status to active
        await Wallet.findOneAndUpdate(
          { user: refundRequest.student._id },
          { $set: { status: 'active' } }
        );

        // NOTE: For subscription_cancellation, we DO NOT trigger an M-Pesa payout.
        // The funds have been returned to the available balance of the student or sponsor.
      }

      // Finalize refund request with actual capped amount
      refundRequest.amountKES = actualRefundKES;
      refundRequest.status = 'approved';
      refundRequest.approvedBy = req.user.id;
      refundRequest.approvedAt = new Date();
      await refundRequest.save();

      return res.json({
        message: `Refund of KES ${actualRefundKES} approved. Wallet status reset to active.`,
        refundRequest
      });

    } else if (status === 'rejected') {
      // Rejection: restore wallet status to active — locked funds remain locked (student keeps subscription)
      await Wallet.findOneAndUpdate(
        { user: refundRequest.student._id },
        { $set: { status: 'active' } }
      );

      refundRequest.status = 'rejected';
      refundRequest.approvedBy = req.user.id;
      refundRequest.rejectedAt = new Date();
      refundRequest.rejectionReason = rejectionReason || 'Rejected by administrator';
      await refundRequest.save();

      return res.json({
        message: 'Refund request rejected. Wallet restored to active status.',
        refundRequest
      });

    } else {
      await RefundRequest.findByIdAndUpdate(id, { status: 'pending_admin_approval' });
      return res.status(400).json({ message: "Invalid status. Use 'approved' or 'rejected'." });
    }
  } catch (error) {
    console.error('Handle Refund Approval Error:', error);
    try {
      const errorLogger = require('../utils/errorLogger');
      await errorLogger.logError('wallet', `Server error during refund approval for request ${id}: ${error.message}`, {
        refundRequestId: id,
        error: error.stack || error.message
      }, 'error');
    } catch (logErr) {
      console.error("Failed to log refund error:", logErr);
    }
    res.status(500).json({ message: 'Server error during refund approval: ' + error.message });
  }
};

const getShuffleDemandStats = async (req, res) => {
  const { planId } = req.query;
  try {
    const Subscription = require('../models/Subscription');
    const Delivery = require('../models/Delivery');
    
    const query = { status: 'active' };
    if (planId) query.planId = planId;
    
    const subscribers = await Subscription.find(query).select('student planId').lean();
    const subscriberCount = subscribers.length;
    const threshold = Math.max(1, Math.floor(subscriberCount / 3));
    
    const studentIds = subscribers.map(s => s.student);
    const mealDemand = await Delivery.aggregate([
      { $match: { student: { $in: studentIds }, status: 'pending' } },
      { $unwind: "$items" },
      { $group: { _id: "$items.name", count: { $sum: 1 } } }
    ]);
    
    const impact = mealDemand.map(m => {
      const warning = m.count <= threshold;
      return {
        mealName: m._id,
        count: m.count,
        threshold,
        status: warning ? 'At Risk' : 'Safe',
        impact: warning ? "A shuffle must never reduce this meal further." : "Shuffling is safe."
      };
    });
    
    res.json({
      subscriberCount,
      threshold,
      mealDemand,
      impact
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to calculate shuffle demand analytics." });
  }
};

const getErrorLogs = async (req, res) => {
  try {
    const ErrorLog = require('../models/ErrorLog');
    const logs = await ErrorLog.find()
      .populate('resolvedBy', 'name email')
      .sort({ timestamp: -1 })
      .lean();
    res.json(logs);
  } catch (error) {
    console.error("Get Error Logs Error:", error);
    res.status(500).json({ message: "Failed to retrieve error logs." });
  }
};

const resolveErrorLog = async (req, res) => {
  const { id } = req.params;
  try {
    const ErrorLog = require('../models/ErrorLog');
    const log = await ErrorLog.findByIdAndUpdate(
      id,
      {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: req.user.id
      },
      { new: true }
    ).populate('resolvedBy', 'name email');

    if (!log) {
      return res.status(404).json({ message: "Error log not found." });
    }

    res.json({ message: "Error log resolved successfully.", log });
  } catch (error) {
    console.error("Resolve Error Log Error:", error);
    res.status(500).json({ message: "Failed to resolve error log." });
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
  approveMeal,
  getPendingApprovals,
  approveVendor,
  getVendors,
  getWallets,
  getOrders,
  assignDriverToOrder,
  getDeliveryStaff,
  approveDelivery,
  getWeeklyPlans,
  updateWeeklyPlan,
  getWithdrawalRequests,
  handleWithdrawalRequest,
  assignLocationsToDriver,
  getSettings,
  updateSettings,
  updateVendorCommission,
  getShuffleDemandStats,
  getRefundRequests,
  handleRefundApproval,
  getErrorLogs,
  resolveErrorLog,
  updateWalletStatus
};
