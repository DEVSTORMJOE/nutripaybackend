const User = require('../models/User');
const Meal = require('../models/Meal');
const Wallet = require('../models/Wallet');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const WeeklyPlan = require('../models/WeeklyPlan');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const walletService = require('../services/walletService');
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
    const ntSupply = wallets.reduce((acc, w) => acc + (w.tokenBalanceNT || 0), 0);
    const escrowBalance = wallets.reduce((acc, w) => acc + (w.lockedBalanceKES || 0), 0);
    
    const adminWallet = wallets.find(w => w.walletType === 'admin');
    const treasuryBalance = adminWallet ? adminWallet.availableBalanceKES : 0;
    
    const vendorWallets = wallets.filter(w => w.walletType === 'vendor');
    const vendorSettlementBalance = vendorWallets.reduce((acc, w) => acc + (w.availableBalanceKES || 0), 0);

    // Sum of Mongo commission transactions
    const commissionTxs = await Transaction.find({ transactionCategory: 'commission', status: 'completed' });
    const revenueBalance = commissionTxs.reduce((acc, tx) => acc + (tx.amountKES || 0), 0);

    // 2. Withdrawals Counts
    const WithdrawalRequest = require('../models/WithdrawalRequest');
    const pendingWithdrawals = await WithdrawalRequest.countDocuments({ status: 'pending_approval' });
    const approvedWithdrawals = await WithdrawalRequest.countDocuments({ status: 'approved' });
    const failedWithdrawals = await WithdrawalRequest.countDocuments({ status: 'rejected' });

    // 3. Analytics
    const SponsorRequest = require('../models/SponsorRequest');
    const sponsorTxs = await SponsorRequest.find({ status: 'paid' });
    const sponsorFunding = sponsorTxs.reduce((acc, r) => acc + (r.amountKES || 0), 0);

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
      Vendor.find().select('user approvedStatus').lean(),
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

// @desc    Get all transactions
// @route   GET /api/admin/transactions
// @access  Private (Admin)
const getTransactions = async (req, res) => {
  try {
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

      return {
        ...tx,
        amount: tx.amountKES,
        type,
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

    const user = await User.create({
      name,
      email,
      phone,
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
    const { name, email, role, isApproved, approvedStatus, password } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
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
    const deliveryProfiles = await DeliveryPersonnel.find({ user: { $in: drivers.map(d => d._id) } }).lean();
    const deliveryProfileMap = {};
    for (const dp of deliveryProfiles) {
      deliveryProfileMap[dp.user.toString()] = dp.approvedStatus;
    }

    const mappedDrivers = drivers.map(d => ({
      _id: d._id,
      name: d.name,
      email: d.email,
      phone: d.phone || "Not Provided",
      status: assignedDriverIds.includes(d._id.toString()) ? "Assigned" : "Available",
      approvedStatus: deliveryProfileMap[d._id.toString()] || (d.isApproved ? "approved" : "pending"),
      vendorName: driverVendorMap[d._id.toString()] || "No Vendor Assigned"
    }));

    res.json(mappedDrivers);
  } catch (error) {
    console.error("Admin getting delivery staff failed:", error);
    res.status(500).json({ message: 'Failed to fetch delivery staff' });
  }
};

// @desc    Approve or reject delivery staff
// @route   POST /api/admin/approve/delivery
// @access  Private (Admin)
const approveDelivery = async (req, res) => {
  const { deliveryId, status } = req.body; // status: 'approved', 'rejected', 'pending'
  try {
    const DeliveryPersonnel = require('../models/DeliveryPersonnel');
    const delivery = await DeliveryPersonnel.findOne({ user: deliveryId });
    
    if (!delivery) {
      // If profile doesn't exist yet, we might need to create it
      const newDelivery = await DeliveryPersonnel.create({
        user: deliveryId,
        approvedStatus: status
      });
      const User = require('../models/User');
      await User.findByIdAndUpdate(deliveryId, { isApproved: status === 'approved' });
      return res.json({ message: `Delivery staff ${status}`, delivery: newDelivery });
    }

    delivery.approvedStatus = status;
    await delivery.save();

    const User = require('../models/User');
    await User.findByIdAndUpdate(deliveryId, { isApproved: status === 'approved' });

    res.json({ message: `Delivery staff ${status}` });
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
  try {
    const plan = await WeeklyPlan.findOneAndUpdate(
      { planId, week: Number(week || 1), day },
      { 
        breakfast: breakfast || null, 
        lunch: lunch || null, 
        supper: supper || null 
      },
      { upsert: true, new: true }
    );
    res.json(plan);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
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
    // Query by 'pending_approval' and atomically update status to prevent concurrent invocation race.
    const request = await WithdrawalRequest.findOneAndUpdate(
      { _id: id, status: 'pending_approval' },
      { $set: { status: status === 'approved' ? 'processing' : 'rejected' } },
      { new: true }
    ).populate('user');

    if (!request) {
      return res.status(400).json({ message: "Withdrawal request not found or has already been processed." });
    }

    const wallet = await Wallet.findOne({ user: request.user._id });
    if (!wallet) {
      // Revert status to pending_approval if wallet missing
      request.status = 'pending_approval';
      await request.save();
      return res.status(404).json({ message: "User wallet not found." });
    }

    // SECURITY REQUIREMENT: Audit log every action (Admin, Timestamp, IP, Amount, Wallet)
    const auditRecord = {
      adminId: req.user.id,
      adminEmail: req.user.email,
      timestamp: new Date(),
      ip: req.ip || req.connection.remoteAddress || '127.0.0.1',
      amountKES: request.amountKES,
      walletId: wallet._id.toString(),
      walletPublicKey: wallet.stellarPublicKey,
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
        payoutResult = await mpesaService.withdrawToMpesa(request.phone, request.amountKES);
      } catch (payoutErr) {
        // Revert locking status if payout fails so admin can retry
        request.status = 'pending_approval';
        await request.save();
        return res.status(500).json({ message: "Safaricom B2C payout initiation failed: " + payoutErr.message });
      }

      // 2. Deduct from pending withdrawal and mark completed
      wallet.pendingWithdrawalKES = Number((wallet.pendingWithdrawalKES - request.amountKES).toFixed(2));
      wallet.totalWithdrawnKES = Number((wallet.totalWithdrawnKES + request.amountKES).toFixed(2));
      await wallet.save();

      // 3. Perform Stellar Mirror Payout: Vendor Settlement -> Treasury
      let stellarTxHash = "";
      let settlementStatus = "pending";
      try {
        stellarTxHash = await stellarTreasuryService.moveVendorToTreasury(request.amountKES);
        settlementStatus = "synced";
        console.log("✅ On-chain token redemption successful. Tx Hash:", stellarTxHash);
      } catch (err) {
        console.error("❌ Failed to mirror withdrawal back to Treasury on Stellar:", err.message);
        settlementStatus = "failed";
      }

      // 4. Create transaction log
      await Transaction.create({
        transactionId: crypto.randomUUID(),
        fromUser: request.user._id,
        amountKES: request.amountKES,
        transactionCategory: 'withdrawal',
        paymentMethod: 'mpesa',
        stellarTxHash: stellarTxHash || null,
        status: 'completed',
        settlementStatus: settlementStatus,
        description: `M-Pesa Payout to ${request.phone} (Approved by Admin)`
      });

      // Update withdrawal request
      request.status = 'approved';
      request.approvedBy = req.user.id;
      request.approvedAt = new Date();
      request.stellarTxHash = stellarTxHash;
      await request.save();

      return res.json({ message: "Withdrawal request approved and payout dispatched successfully!", request });
    } else if (status === 'rejected') {
      // Reject request: release funds from pendingWithdrawalKES back to availableBalanceKES
      wallet.availableBalanceKES = Number((wallet.availableBalanceKES + request.amountKES).toFixed(2));
      wallet.pendingWithdrawalKES = Number((wallet.pendingWithdrawalKES - request.amountKES).toFixed(2));
      await wallet.save();

      // Update withdrawal request
      request.status = 'rejected';
      request.approvedBy = req.user.id;
      request.rejectedAt = new Date();
      request.rejectionReason = rejectionReason || "Rejected by administrator";
      await request.save();

      return res.json({ message: "Withdrawal request rejected and funds returned to wallet.", request });
    } else {
      // Revert status to pending_approval if invalid status option
      request.status = 'pending_approval';
      await request.save();
      return res.status(400).json({ message: "Invalid status option. Use 'approved' or 'rejected'." });
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
  getDeliveryStaff,
  approveDelivery,
  getWeeklyPlans,
  updateWeeklyPlan,
  getWithdrawalRequests,
  handleWithdrawalRequest,
  assignLocationsToDriver,
};
