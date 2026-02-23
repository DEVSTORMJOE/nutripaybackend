const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
// @access  Private
const getWalletBalance = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    res.json({ balance: wallet.balance, publicKey: wallet.stellarPublicKey });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get wallet transactions
// @route   GET /api/wallet/transactions
// @access  Private
const getTransactions = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    const transactions = await Transaction.find({
      $or: [{ fromWallet: wallet._id }, { toWallet: wallet._id }]
    }).sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getWalletBalance,
  getTransactions
};
