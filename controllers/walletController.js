const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarService = require('../services/stellarService');

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
// @access  Private
const getWalletBalance = async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ user: req.user.id });
    
    // Auto-provision wallet if it doesn't exist
    if (!wallet) {
      console.log(`Provisioning missing Stellar wallet for user ${req.user.id} during balance check.`);
      const keypair = await stellarService.createWallet();
      wallet = await Wallet.create({
          user: req.user.id,
          stellarPublicKey: keypair.publicKey,
          stellarSecretKey: keypair.secret,
          walletType: req.user.role || 'student',
          balance: 0
      });
    }

    // Try fetching live balance from Stellar Network
    try {
      if (wallet.stellarPublicKey) {
        const liveXlmBalance = await stellarService.getBalance(wallet.stellarPublicKey);
        
        if (liveXlmBalance !== null) {
            // Convert live XLM balance to KES
            const liveKesBalance = stellarService.XLM_to_KES(liveXlmBalance);
            
            // Only update if it is a valid positive number
            if (!isNaN(liveKesBalance) && parseFloat(liveKesBalance) >= 0) {
                wallet.balance = parseFloat(liveKesBalance);
                await wallet.save();
            }
        }
      }
    } catch (stellarError) {
      console.error("Failed to fetch live Stellar balance, falling back to MongoDB cache:", stellarError);
    }

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

// @desc    Mock fund a wallet (Demo/Prototype only)
// @route   POST /api/wallet/mock-fund
// @access  Private
const mockFund = async (req, res) => {
  try {
    const { amountKes } = req.body;
    
    if (!amountKes || amountKes <= 0) {
        return res.status(400).json({ message: "Please provide a valid KES amount to fund." });
    }

    let wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found. Please check your balance first to auto-provision." });
    }

    // For the prototype, we just artificially increase the MongoDB KES balance.
    // In a real app, this would be an M-Pesa or Card webhook that then triggers a real Stellar mint/transfer.
    wallet.balance += Number(amountKes);
    await wallet.save();

    res.json({ message: `Successfully added ${amountKes} KES mock balance!`, newBalance: wallet.balance });
  } catch (error) {
    console.error("Mock fund error:", error);
    res.status(500).json({ message: 'Server error during mock funding.' });
  }
};

module.exports = {
  getWalletBalance,
  getTransactions,
  mockFund
};
