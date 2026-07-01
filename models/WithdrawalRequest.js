const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amountKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['requested', 'approved', 'b2c_pending', 'b2c_success', 'completed', 'rejected'],
    default: 'requested'
  },
  notificationSent: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: ""
  },
  stellarTxHash: {
    type: String,
    default: null
  },
  mpesaReceipt: {
    type: String,
    default: null
  },
  conversationId: {
    type: String,
    sparse: true
  },
  originatorConversationId: {
    type: String,
    sparse: true
  }
}, { timestamps: true });

const WithdrawalRequest = mongoose.models.WithdrawalRequest || mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
module.exports = WithdrawalRequest;
