const mongoose = require('mongoose');

const fundingSourceSchema = new mongoose.Schema({
  sourceType: {
    type: String,
    enum: ['sponsor', 'self', 'institution', 'scholarship'],
    default: 'self'
  },
  amountKES: {
    type: Number,
    default: 0
  },
  restrictedUsage: {
    type: Boolean,
    default: false
  },
  restrictedUsageType: {
    type: String,
    enum: ['subscription_only', 'none'],
    default: 'none'
  },
  nutritionCategory: {
    type: [String],
    default: []
  },
  expiryDate: {
    type: Date
  }
}, { _id: false });

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  walletType: {
    type: String,
    enum: ['student', 'sponsor', 'vendor', 'admin'],
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
  tokenBalanceNT: {
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
  },
  walletFundingSources: {
    type: [fundingSourceSchema],
    default: []
  }
}, { timestamps: true });

// Pre-save hook to keep tokenBalanceNT in sync
walletSchema.pre('save', function(next) {
  this.tokenBalanceNT = Number((this.availableBalanceKES + this.lockedBalanceKES).toFixed(2));
  next();
});

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
module.exports = Wallet;

