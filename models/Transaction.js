const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  fromWallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet'
  },
  toWallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet'
  },
  amount: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['funding', 'payment', 'refund', 'payout', 'withdrawal', 'deposit'],
    required: true
  },
  stellarTxHash: {
    type: String,
    required: true
  },
  description: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
