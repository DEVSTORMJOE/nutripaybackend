const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  walletType: {
    type: String,
    enum: ['student', 'sponsor', 'vendor', 'admin', 'delivery'],
    required: true
  },
  availableBalanceKES: {
    type: Number,
    default: 0
  },
  lockedBalanceKES: {
    type: Number,
    default: 0
  },
  pendingWithdrawalKES: {
    type: Number,
    default: 0
  },
  totalDepositedKES: {
    type: Number,
    default: 0
  },
  totalSpentKES: {
    type: Number,
    default: 0
  },
  totalWithdrawnKES: {
    type: Number,
    default: 0
  },
  totalRefundedKES: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'frozen', 'refund_pending', 'suspended'],
    default: 'active'
  }
}, { timestamps: true });

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
module.exports = Wallet;
