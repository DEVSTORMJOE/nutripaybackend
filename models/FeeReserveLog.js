const mongoose = require('mongoose');

const feeReserveLogSchema = new mongoose.Schema({
  sourceWallet: {
    type: String,
    required: true,
    trim: true
  },
  destinationWallet: {
    type: String,
    required: true,
    trim: true
  },
  destinationWalletName: {
    type: String,
    required: true,
    trim: true
  },
  amountXLM: {
    type: Number,
    required: true
  },
  previousBalanceXLM: {
    type: Number,
    default: 0
  },
  targetBalanceXLM: {
    type: Number,
    default: 0
  },
  transactionHash: {
    type: String,
    default: null,
    trim: true
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED'],
    default: 'SUCCESS'
  },
  errorMessage: {
    type: String,
    default: null
  },
  triggeredBy: {
    type: String,
    enum: ['CRON', 'MANUAL_ADMIN', 'SYSTEM'],
    default: 'CRON'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

feeReserveLogSchema.index({ timestamp: -1 });
feeReserveLogSchema.index({ destinationWallet: 1 });
feeReserveLogSchema.index({ status: 1 });

module.exports = mongoose.model('FeeReserveLog', feeReserveLogSchema);
