const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const stellarService = require('../services/stellarService');
const notificationService = require('../services/notificationService');

// @desc    Get sponsor dashboard stats
// @route   GET /api/sponsor/dashboard
// @access  Private (Sponsor)
const getDashboard = async (req, res) => {
  try {
    const sponsorId = req.user.id;
    const wallet = await Wallet.findOne({ user: sponsorId });
    const beneficiaries = await User.findById(sponsorId).populate('linkedAccounts', 'name email');

    res.json({
      balance: wallet ? wallet.balance : 0,
      beneficiaries: beneficiaries.linkedAccounts
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

// @desc    Get student details
// @route   GET /api/sponsor/student/:id
// @access  Private (Sponsor)
const getStudentDetails = async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select('-password');
    const subscription = await Subscription.findOne({ student: req.params.id, status: 'active' }).populate('plan');

    res.json({ student, subscription });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getDashboard,
  fundStudentWallet,
  getStudentDetails
};
