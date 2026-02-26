const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const Delivery = require('../models/Delivery');
const stellarService = require('../services/stellarService');
const notificationService = require('../services/notificationService');

// @desc    Get sponsor dashboard stats
// @route   GET /api/sponsor/dashboard
// @access  Private (Sponsor)
const getDashboard = async (req, res) => {
  try {
    const sponsorId = req.user.id;
    let wallet = await Wallet.findOne({ user: sponsorId });
    
    // Auto-provision wallet if missing (e.g. registered via UI instead of Add Sponsor flow)
    if (!wallet) {
      console.log(`Provisioning missing Stellar wallet for sponsor ${sponsorId}.`);
      const keypair = await stellarService.createWallet(true); // true = friendbot funding
      wallet = await Wallet.create({
        user: sponsorId,
        stellarPublicKey: keypair.publicKey,
        stellarSecretKey: keypair.secret,
        walletType: 'sponsor',
        balance: 10000 // Testnet default
      });
    }

    const beneficiaries = await User.findById(sponsorId).populate('linkedAccounts', 'name email');

    res.json({
      balance: wallet ? wallet.balance : 0,
      beneficiaries: beneficiaries ? beneficiaries.linkedAccounts : []
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Fund a student wallet
// @route   POST /api/sponsor/fund-wallet
// @access  Private (Sponsor)
const fundStudentWallet = async (req, res) => {
  const { studentId, amount } = req.body;

  try {
    const sponsorWallet = await Wallet.findOne({ user: req.user.id }).select('+stellarSecretKey');
    const studentWallet = await Wallet.findOne({ user: studentId });

    if (!sponsorWallet || !studentWallet) {
      return res.status(404).json({ message: 'Wallets not found' });
    }

    // Perform Stellar Payment
    // For prototype, we assume sponsorWallet has secret key stored (custodial)
    // In production, sponsor would sign client-side or use a secure vault
    if (!sponsorWallet.stellarSecretKey) {
      return res.status(400).json({ message: 'Sponsor wallet secret not found (Non-custodial not supported in prototype)' });
    }

    const tx = await stellarService.fundWallet(sponsorWallet.stellarSecretKey, studentWallet.stellarPublicKey, amount);

    // Record Transaction
    await Transaction.create({
      fromWallet: sponsorWallet._id,
      toWallet: studentWallet._id,
      amount,
      type: 'funding',
      stellarTxHash: tx.hash,
      description: `Funding for student ${studentId}`,
      status: 'completed'
    });

    // Update balances in DB (optional, but good for quick UI)
    // In real app, listen to Stellar events
    sponsorWallet.balance -= Number(amount);
    studentWallet.balance += Number(amount);
    await sponsorWallet.save();
    await studentWallet.save();

    // Notify
    const student = await User.findById(studentId);
    await notificationService.sendPaymentSuccess(student.email, amount, 'Sponsorship Funding');

    res.json({ message: 'Funding successful', txHash: tx.hash });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Payment failed' });
  }
};

// @desc    Get all sponsored students & their delivery histories
// @route   GET /api/sponsor/students
// @access  Private (Sponsor)
const getSponsoredStudents = async (req, res) => {
  try {
    const sponsorId = req.user.id;
    const sponsor = await User.findById(sponsorId).populate('linkedAccounts', '-password');
    
    if (!sponsor) return res.status(404).json({ message: 'Sponsor not found' });

    const students = [];
    for (const student of sponsor.linkedAccounts) {
      // Find deliveries belonging to this student (both pending/active and past)
      const deliveries = await Delivery.find({ 
        student: student._id, 
        status: { $in: ['pending', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'] } 
      }).sort({ scheduledDate: -1 }).limit(30); // Last 30 deliveries

      students.push({
        _id: student._id,
        name: student.name,
        email: student.email,
        phone: student.phone,
        avatar: student.avatar,
        deliveries
      });
    }

    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get pending student requests for this sponsor
// @route   GET /api/sponsor/pending-requests
// @access  Private (Sponsor)
const getPendingRequests = async (req, res) => {
  try {
    const deliveries = await Delivery.find({ sponsor: req.user.id, status: 'awaiting_sponsor' })
      .populate('student', 'name email');

    const grouped = {};
    for (const d of deliveries) {
      if (!d.student) continue;
      const sId = d.student._id.toString();
      if (!grouped[sId]) {
        grouped[sId] = {
          student: d.student,
          deliveryCount: 0,
          totalCost: 0,
          deliveryIds: [],
          deliveries: []
        };
      }
      grouped[sId].deliveryCount += 1;
      grouped[sId].totalCost += (d.totalCost || 0);
      grouped[sId].deliveryIds.push(d._id);
      
      grouped[sId].deliveries.push({
        _id: d._id,
        scheduledDate: d.scheduledDate,
        timeSlot: d.timeSlot,
        items: d.items || [],
        vendor: d.vendor,
        totalCost: d.totalCost
      });
    }

    res.json(Object.values(grouped));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Fund pending requests for a specific student
// @route   POST /api/sponsor/fund-request
// @access  Private (Sponsor)
const fundRequest = async (req, res) => {
  const { studentId, deliveryIds } = req.body;
  try {
    const deliveries = await Delivery.find({ _id: { $in: deliveryIds }, sponsor: req.user.id, status: 'awaiting_sponsor', student: studentId });
    if (deliveries.length === 0) return res.status(404).json({ message: "No pending requests found." });

    const totalKes = deliveries.reduce((acc, d) => acc + (d.totalCost || 0), 0);

    const sponsorWallet = await Wallet.findOne({ user: req.user.id }).select('+stellarSecretKey');
    const studentWallet = await Wallet.findOne({ user: studentId }).select('+stellarSecretKey');
    
    // We get Admin Escrow Wallet directly
    let adminWallet = await Wallet.findOne({ walletType: 'admin' });

    if (!sponsorWallet || !sponsorWallet.stellarSecretKey) return res.status(400).json({ message: "Sponsor wallet missing or invalid." });
    if (!studentWallet || !studentWallet.stellarSecretKey) return res.status(400).json({ message: "Student wallet missing." });
    if (!adminWallet) return res.status(500).json({ message: "Admin escrow missing." });

    if (sponsorWallet.balance < totalKes) {
      return res.status(400).json({ message: "Insufficient balance in Sponsor Wallet." });
    }

    // Process double payment via Escrow
    // 1. Sponsor -> Student
    const tx1 = await stellarService.makePayment(sponsorWallet.stellarSecretKey, studentWallet.stellarPublicKey, totalKes);
    
    // Log Transaction 1
    await Transaction.create({
      fromWallet: sponsorWallet._id,
      toWallet: studentWallet._id,
      amount: totalKes,
      type: 'funding',
      stellarTxHash: tx1.hash,
      description: `Funding for student scheduled meals`,
      status: 'completed'
    });

    // 2. Student -> Admin (Checkout Payment to Escrow)
    const tx2 = await stellarService.makePayment(studentWallet.stellarSecretKey, adminWallet.stellarPublicKey, totalKes);

    // Log Transaction 2
    await Transaction.create({
      fromWallet: studentWallet._id,
      toWallet: adminWallet._id,
      amount: totalKes,
      type: 'payment',
      stellarTxHash: tx2.hash,
      description: `Cart checkout escrow for ${deliveries.length} days`,
      status: 'completed'
    });

    // Balances
    sponsorWallet.balance -= totalKes;
    await sponsorWallet.save();

    adminWallet.balance += totalKes;
    await adminWallet.save();

    // Update Deliveries to pending
    await Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'pending' } });
    
    // Also notify vendors that we actually got an order (since they were awaiting sponsor)
    const Notification = require('../models/Notification');
    const vendorTotals = {};
    deliveries.forEach(d => {
      if(!vendorTotals[d.vendor]) vendorTotals[d.vendor] = 0;
      vendorTotals[d.vendor] += d.totalCost;
    });

    const Vendor = require("../models/Vendor");
    const targetVendors = await Vendor.find({ _id: { $in: Object.keys(vendorTotals) } });
    
    for (const vDoc of targetVendors) {
      await Notification.create({
        user: vDoc.user,
        type: 'order',
        title: 'New Student Order via Sponsor',
        message: `A student just scheduled deliveries totaling ${vendorTotals[vDoc._id.toString()]} KES.`
      });
    }

    res.json({ message: "Successfully funded student deliveries!", txHash: tx2.hash });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to process sponsor checkout." });
  }
};

module.exports = {
  getDashboard,
  fundStudentWallet,
  getSponsoredStudents,
  getPendingRequests,
  fundRequest
};
