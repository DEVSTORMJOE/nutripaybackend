const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');
const notificationService = require('../services/notificationService');
const SponsorRequest = require('../models/SponsorRequest');
const Notification = require('../models/Notification');

// @desc    Get sponsor dashboard stats
// @route   GET /api/sponsor/dashboard
// @access  Private (Sponsor)
const getDashboard = async (req, res) => {
  try {
    const sponsorId = req.user.id;
    const wallet = await walletService.getOrCreateWallet(sponsorId, 'sponsor');
    const beneficiaries = await User.findById(sponsorId).populate('linkedAccounts', 'name email');

    res.json({
      balance: wallet.availableBalanceKES,
      availableBalanceKES: wallet.availableBalanceKES,
      lockedBalanceKES: wallet.lockedBalanceKES,
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
  const sponsorId = req.user.id;

  try {
    const sponsorWallet = await walletService.getOrCreateWallet(sponsorId, 'sponsor');
    const studentWallet = await walletService.getOrCreateWallet(studentId, 'student');

    if (sponsorWallet.availableBalanceKES < Number(amount)) {
      return res.status(400).json({ message: 'Insufficient available balance in Sponsor Wallet' });
    }

    // Debit sponsor, Credit student internally (both are custodial treasury balances, no Stellar Tx needed)
    await walletService.debitWallet(
      sponsorId,
      amount,
      'funding',
      'wallet',
      `Sponsorship funding for student: ${studentId}`
    );

    await walletService.creditWallet(
      studentId,
      amount,
      'funding',
      'wallet',
      `Sponsorship funding from sponsor: ${sponsorId}`
    );

    // Notify student
    const student = await User.findById(studentId);
    try {
      await notificationService.sendPaymentSuccess(student.email, amount, 'Sponsorship Funding');
    } catch (e) {
      console.warn("Notification error:", e.message);
    }

    // In-app notification to sponsor
    try {
      await Notification.create({
        user: sponsorId,
        type: 'sponsorship',
        title: 'Student Funded Successfully',
        message: `You successfully funded ${amount} KES to ${student?.name || 'a student'}. Funds are now available for meal purchases.`
      });
    } catch (e) {
      console.warn("In-app notification error:", e.message);
    }

    res.json({ message: 'Funding successful', newBalance: sponsorWallet.availableBalanceKES });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Payment failed: ' + error.message });
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
      }).sort({ scheduledDate: -1 }); // Get ALL deliveries for complete history

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

const fundRequest = async (req, res) => {
  const { studentId, deliveryIds } = req.body;
  const sponsorId = req.user.id;

  try {
    const deliveries = await Delivery.find({ _id: { $in: deliveryIds }, sponsor: sponsorId, status: 'awaiting_sponsor', student: studentId });
    if (deliveries.length === 0) return res.status(404).json({ message: "No pending requests found." });

    const totalKes = deliveries.reduce((acc, d) => acc + (d.totalCost || 0), 0);

    // 1. Debit Sponsor's available balance
    await walletService.debitWallet(
      sponsorId,
      totalKes,
      'funding',
      'wallet',
      `Subscription request funding for student: ${studentId}`
    );

    // 2. Credit Student's available balance first (unified available balance flow)
    const creditRes = await walletService.creditWallet(
      studentId,
      totalKes,
      'funding',
      'wallet',
      `Sponsor request funding from sponsor: ${sponsorId}`
    );
    creditRes.transaction.paymentSource = 'sponsor_funds';
    await creditRes.transaction.save();

    // 3. Immediately lock subscription funds from the student's available balance to locked subscription balance
    const lockResult = await escrowService.lockSubscriptionFunds(studentId, totalKes, sponsorId);

    // Update Deliveries to pending
    await Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'pending' } });

    // Locate the matching SponsorRequest
    const request = await SponsorRequest.findOne({
      student: studentId,
      deliveryIds: { $in: deliveryIds },
      status: 'pending'
    });

    if (request) {
      request.status = 'paid';
      await request.save();
    }

    // Set studentProfile.subscriptionActive = true
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: studentId });
    if (studentProfile) {
      studentProfile.subscriptionActive = true;
      await studentProfile.save();
    }

    // Create an active Subscription record
    const Subscription = require('../models/Subscription');
    let planId = 'essential';
    let startDate = new Date();
    let endDate = new Date(startDate.getTime() + 27 * 24 * 60 * 60 * 1000);
    if (request) {
      planId = request.planId || 'essential';
      if (request.startDate) startDate = request.startDate;
      if (request.endDate) endDate = request.endDate;
    }

    await Subscription.create({
      student: studentId,
      planId: planId,
      sponsor: sponsorId,
      status: 'active',
      startDate: startDate,
      endDate: endDate,
      totalPaidKES: totalKes
    });
    
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

    // In-app notification to sponsor confirming the funding
    try {
      await Notification.create({
        user: sponsorId,
        type: 'sponsorship',
        title: 'Pending Requests Funded',
        message: `You approved and funded ${deliveries.length} delivery request(s) totaling ${totalKes} KES. Deliveries are now scheduled!`
      });
    } catch (e) {
      console.warn("In-app notification error:", e.message);
    }

    res.json({
      message: "Successfully funded student deliveries!",
      newBalance: lockResult.studentWallet.availableBalanceKES
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to process sponsor checkout: " + error.message });
  }
};

const getRequestDetails = async (req, res) => {
  try {
    const { token } = req.params;
    const request = await SponsorRequest.findOne({ token }).populate('student', 'name email');
    if (!request) return res.status(404).json({ message: "Sponsorship request not found." });
    
    res.json({
      studentName: request.student?.name,
      studentEmail: request.student?.email,
      amountKES: request.amountKES,
      deliveryCount: request.deliveryIds?.length || 0,
      status: request.status,
      sponsorEmail: request.sponsorEmail
    });
  } catch (e) {
    res.status(500).json({ message: "Server error resolving request." });
  }
};

const quickPay = async (req, res) => {
  const { token } = req.body;
  try {
    const request = await SponsorRequest.findOne({ token, status: 'pending' });
    if (!request) return res.status(404).json({ message: "Active sponsorship request not found." });

    // Let's resolve sponsor User account or create if missing
    let sponsor = await User.findOne({ email: request.sponsorEmail });
    if (!sponsor) {
      const crypto = require('crypto');
      const generatedPassword = crypto.randomBytes(8).toString("hex");
      sponsor = await User.create({
        name: request.sponsorName,
        email: request.sponsorEmail,
        password: generatedPassword,
        role: 'sponsor',
        isApproved: true
      });

      const Sponsor = require('../models/Sponsor');
      await Sponsor.create({
        user: sponsor._id,
        organizationName: request.sponsorName || "Sponsor",
        contactPhone: ""
      });
      
      // Credit mock funds
      await walletService.creditWallet(
        sponsor._id,
        10000,
        'deposit',
        'wallet',
        'Sponsor Mock Funding'
      );
    }

    const sponsorId = sponsor._id;
    const studentId = request.student;
    const totalKes = request.amountKES;
    const deliveryIds = request.deliveryIds;

    // Credit sponsor if they have insufficient balance
    const sponsorWallet = await Wallet.findOne({ user: sponsorId });
    if (!sponsorWallet || sponsorWallet.availableBalanceKES < totalKes) {
      await walletService.creditWallet(
        sponsorId,
        totalKes,
        'deposit',
        'wallet',
        'Auto Sponsor Funding for Quick Checkout'
      );
    }

    // 1. Debit Sponsor
    await walletService.debitWallet(
      sponsorId,
      totalKes,
      'funding',
      'wallet',
      `Subscription quick sponsor funding for student: ${studentId}`
    );

    // 2. Credit Student available balance
    const creditRes = await walletService.creditWallet(
      studentId,
      totalKes,
      'funding',
      'wallet',
      `Sponsor request funding from sponsor: ${sponsorId}`
    );
    creditRes.transaction.paymentSource = 'sponsor_funds';
    await creditRes.transaction.save();

    // 3. Immediately lock subscription funds
    const lockResult = await escrowService.lockSubscriptionFunds(studentId, totalKes, sponsorId);

    // Update Deliveries status to pending
    await Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'pending' } });
    
    // Create an active Subscription record
    const Subscription = require('../models/Subscription');
    await Subscription.create({
      student: studentId,
      planId: request.planId || 'essential',
      sponsor: sponsorId,
      status: 'active',
      startDate: request.startDate || new Date(),
      endDate: request.endDate || new Date(Date.now() + 27 * 24 * 60 * 60 * 1000),
      totalPaidKES: totalKes
    });

    // Set studentProfile.subscriptionActive = true
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: studentId });
    if (studentProfile) {
      studentProfile.subscriptionActive = true;
      await studentProfile.save();
    }

    // Update SponsorRequest status
    request.status = 'paid';
    await request.save();

    res.json({
      success: true,
      message: "Sponsorship payment completed successfully!"
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Quick pay failed: " + e.message });
  }
};

const quickPayMpesa = async (req, res) => {
  const { token, phone } = req.body;
  try {
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required." });
    }

    const request = await SponsorRequest.findOne({ token, status: 'pending' });
    if (!request) return res.status(404).json({ message: "Active sponsorship request not found." });

    // Resolve sponsor or create if missing
    let sponsor = await User.findOne({ email: request.sponsorEmail });
    if (!sponsor) {
      const crypto = require('crypto');
      const generatedPassword = crypto.randomBytes(8).toString("hex");
      sponsor = await User.create({
        name: request.sponsorName,
        email: request.sponsorEmail,
        password: generatedPassword,
        role: 'sponsor',
        isApproved: true
      });

      const Sponsor = require('../models/Sponsor');
      await Sponsor.create({
        user: sponsor._id,
        organizationName: request.sponsorName || "Sponsor",
        contactPhone: ""
      });

      // Credit mock funds
      await walletService.creditWallet(
        sponsor._id,
        10000,
        'deposit',
        'wallet',
        'Sponsor Mock Funding'
      );
    }

    const mpesaService = require('../services/mpesaService');
    const crypto = require('crypto');

    try {
      const data = await mpesaService.initiateDeposit(sponsor._id, phone, request.amountKES);
      const checkoutRequestID = data.CheckoutRequestID;
      request.checkoutRequestID = checkoutRequestID;
      await request.save();
      res.json({ message: "STK Push sent successfully to your phone. Waiting for PIN...", checkoutRequestID });
    } catch (err) {
      console.warn("Direct Safaricom STK Push failed, falling back to mock deposit in demo mode:", err.message);
      const mockID = `ws_CO_Mock_${crypto.randomBytes(8).toString('hex')}`;
      request.checkoutRequestID = mockID;
      await request.save();
      res.json({
        message: "STK Push mock sent successfully! (Demo Sandbox Mode)",
        checkoutRequestID: mockID
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "M-Pesa payment initiation failed: " + e.message });
  }
};

const checkSponsorMpesaStatus = async (req, res) => {
  try {
    const { checkoutRequestID } = req.params;
    const request = await SponsorRequest.findOne({ checkoutRequestID });
    if (!request) {
      return res.status(404).json({ message: "Sponsorship request not found" });
    }

    // Auto-approve mock deposits in sandbox/demo environment immediately upon polling
    if (request.status === 'pending' && (checkoutRequestID.startsWith('ws_CO_Mock_') || process.env.NODE_ENV === 'development')) {
      console.log(`[Mock Sponsor Deposit] Auto-approving mock deposit of ${request.amountKES} KES`);
      const mockReceipt = "MOCK_DEP_" + Math.random().toString(36).substring(4).toUpperCase();
      
      let sponsor = await User.findOne({ email: request.sponsorEmail });
      if (!sponsor) {
        const crypto = require('crypto');
        const generatedPassword = crypto.randomBytes(8).toString("hex");
        sponsor = await User.create({
          name: request.sponsorName,
          email: request.sponsorEmail,
          password: generatedPassword,
          role: 'sponsor',
          isApproved: true
        });

        const Sponsor = require('../models/Sponsor');
        await Sponsor.create({
          user: sponsor._id,
          organizationName: request.sponsorName || "Sponsor",
          contactPhone: ""
        });
      }

      // Credit sponsor wallet
      await walletService.creditWallet(
        sponsor._id,
        request.amountKES,
        'deposit',
        'mpesa',
        `M-Pesa Sponsor Payment (Receipt: ${mockReceipt})`
      );

      // Debit sponsor wallet
      await walletService.debitWallet(
        sponsor._id,
        request.amountKES,
        'funding',
        'wallet',
        `Subscription quick sponsor funding for student: ${request.student}`
      );

      // Credit student wallet
      const creditRes = await walletService.creditWallet(
        request.student,
        request.amountKES,
        'funding',
        'wallet',
        `Sponsor request funding from sponsor: ${sponsor._id}`
      );
      creditRes.transaction.paymentSource = 'sponsor_funds';
      await creditRes.transaction.save();

      // Immediately lock subscription funds
      const lockResult = await escrowService.lockSubscriptionFunds(request.student, request.amountKES, sponsor._id);

      // Update Deliveries status to pending
      await Delivery.updateMany({ _id: { $in: request.deliveryIds } }, { $set: { status: 'pending' } });

      // Create active subscription
      const Subscription = require('../models/Subscription');
      await Subscription.create({
        student: request.student,
        planId: request.planId || 'essential',
        sponsor: sponsor._id,
        status: 'active',
        startDate: request.startDate || new Date(),
        endDate: request.endDate || new Date(Date.now() + 27 * 24 * 60 * 60 * 1000),
        totalPaidKES: request.amountKES
      });

      // Set student profile subscription active
      const Student = require('../models/Student');
      const studentProfile = await Student.findOne({ user: request.student });
      if (studentProfile) {
        studentProfile.subscriptionActive = true;
        await studentProfile.save();
      }

      // Mark request as paid
      request.status = 'paid';
      await request.save();
    }

    res.json({ status: request.status, amount: request.amountKES });
  } catch (e) {
    console.error("Sponsor status check error:", e);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  getDashboard,
  fundStudentWallet,
  getSponsoredStudents,
  getPendingRequests,
  fundRequest,
  getRequestDetails,
  quickPay,
  quickPayMpesa,
  checkSponsorMpesaStatus
};
