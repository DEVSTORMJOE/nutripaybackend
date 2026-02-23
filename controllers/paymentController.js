// Mostly handled in sponsorController for funding, but generic payments here
const stellarService = require('../services/stellarService');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

// @desc    Process a generic payment (e.g. valid checkout if not subscription)
// @route   POST /api/payment/checkout
// @access  Private
const checkout = async (req, res) => {
  const { amount, vendorId } = req.body;

  // Check balances, make payment via Stellar, record, etc.
  // Placeholder for now as mainly doing subscriptions
  res.json({ message: 'Not implemented for direct checkout yet, use subscriptions' });
};

module.exports = {
  checkout
};
