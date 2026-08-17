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
    const { explainTransaction } = require('../utils/transactionUtils');
    
    let query = {
      $or: [{ fromUser: req.user.id }, { toUser: req.user.id }]
    };
    
    if (req.user.role === 'student' || req.user.role === 'sponsor') {
      query.transactionCategory = { $nin: ['escrow_release', 'commission'] };
    }

    const transactions = await Transaction.find(query)
    .populate('fromUser', 'name email role')
    .populate('toUser', 'name email role')
    .sort({ createdAt: -1 })
    .lean();

    const mapped = transactions.map(tx => {
      const { source, destination, purpose } = explainTransaction(tx);
      return {
        ...tx,
        source,
        destination,
        purpose
      };
    });

    res.json(mapped);
  } catch (error) {
    console.error("Get Wallet Transactions Error:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Mock fund a wallet (Disabled in Production)
// @route   POST /api/wallet/mock-fund
// @access  Private (Admin Only)
const mockFund = async (req, res) => {
  return res.status(403).json({ message: "Mock funding is disabled in production. Please use M-Pesa deposit." });
};

module.exports = {
  getWalletBalance,
  getTransactions,
  mockFund
};
