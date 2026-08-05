const mongoose = require('mongoose');

const fundingSourceSchema = new mongoose.Schema({
  sourceType: {
    type: String,
    enum: ['sponsor', 'self', 'institution', 'scholarship'],
    default: 'self'
  },
  amountKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
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
    enum: ['student', 'sponsor', 'vendor', 'admin', 'delivery'],
    required: true
  },
  availableBalanceKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  lockedBalanceKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  tokenBalanceNT: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  pendingWithdrawalKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  totalDepositedKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  totalSpentKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  totalWithdrawnKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  totalRefundedKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
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
  const avail = parseFloat(this.availableBalanceKES ? this.availableBalanceKES.toString() : '0');
  const lock = parseFloat(this.lockedBalanceKES ? this.lockedBalanceKES.toString() : '0');
  this.tokenBalanceNT = mongoose.Types.Decimal128.fromString((avail + lock).toFixed(2));
  next();
});

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
module.exports = Wallet;

