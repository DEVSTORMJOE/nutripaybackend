const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  amountKES: {
    type: Number,
    required: true
  },
  transactionCategory: {
    type: String,
    enum: [
      'deposit',
      'subscription_lock',
      'custom_order',
      'vendor_payout',
      'withdrawal',
      'refund',
      'commission',
      'escrow_release',
      'mpesa_direct_order',
      'funding'
    ],
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'wallet', 'stellar'],
    required: true
  },
  paymentSource: {
    type: String,
    enum: [
      'sponsor_funds',
      'student_wallet',
      'mpesa_direct'
    ]
  },
  orderType: {
    type: String,
    enum: ['subscription', 'custom']
  },
  stellarTxHash: {
    type: String
  },
  escrowReference: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'reversed'],
    default: 'pending'
  },
  settlementStatus: {
    type: String,
    enum: ['pending', 'synced', 'failed'],
    default: 'pending'
  }
}, { timestamps: true });

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
