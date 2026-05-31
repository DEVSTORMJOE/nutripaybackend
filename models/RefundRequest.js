const mongoose = require('mongoose');

const refundRequestSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amountKES: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending_admin_approval', 'approved', 'rejected'],
    default: 'pending_admin_approval'
  },
  source: {
    type: String,
    default: 'subscription_cancellation'
  },
  fundingType: {
    type: String,
    enum: ['self', 'sponsor'],
    required: true
  },
  sponsor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    default: null
  },
  deliveryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery'
  }],
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
  }
}, { timestamps: true });

const RefundRequest = mongoose.models.RefundRequest || mongoose.model('RefundRequest', refundRequestSchema);
module.exports = RefundRequest;
