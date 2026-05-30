const walletService = require('../services/walletService');
const Transaction = require('../models/Transaction');

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
// @access  Private
const getWalletBalance = async (req, res) => {
  try {
    const role = req.user.role || 'student';
    const wallet = await walletService.getOrCreateWallet(req.user.id, role);

    res.json({
      availableBalanceKES: wallet.availableBalanceKES,
      lockedBalanceKES: wallet.lockedBalanceKES,
      pendingWithdrawalKES: wallet.pendingWithdrawalKES,
      status: wallet.status || 'active',
      // Backwards compatibility for older UI/scripts
      balance: wallet.availableBalanceKES,
      publicKey: null // No longer exposing Stellar public key to users
    });
  } catch (error) {
    console.error("Get Wallet Balance Error:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get wallet transactions
// @route   GET /api/wallet/transactions
// @access  Private
const getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      $or: [{ fromUser: req.user.id }, { toUser: req.user.id }]
    })
    .populate('fromUser', 'name email role')
    .populate('toUser', 'name email role')
    .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    console.error("Get Wallet Transactions Error:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Mock fund a wallet (Demo/Prototype only)
// @route   POST /api/wallet/mock-fund
// @access  Private
const mockFund = async (req, res) => {
  try {
    const { amountKes } = req.body;
    
    if (!amountKes || amountKes <= 0) {
      return res.status(400).json({ message: "Please provide a valid KES amount to fund." });
    }

    const result = await walletService.creditWallet(
      req.user.id,
      amountKes,
      'deposit',
      'wallet',
      `Mock top-up of ${amountKes} KES`
    );

    res.json({
      message: `Successfully added ${amountKes} KES mock balance!`,
      newBalance: result.wallet.availableBalanceKES
    });
  } catch (error) {
    console.error("Mock fund error:", error);
    res.status(500).json({ message: 'Server error during mock funding: ' + error.message });
  }
};

module.exports = {
  getWalletBalance,
  getTransactions,
  mockFund
};
