const mongoose = require('mongoose');

const sponsorRequestSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  sponsorEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  sponsorName: {
    type: String,
    required: true,
    trim: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deliveryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery'
  }],
  amountKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'expired', 'failed', 'cancelled'],
    default: 'pending'
  },
  planId: {
    type: String,
    default: 'essential'
  },
  startDate: {
    type: Date
  },
  endDate: {
    type: Date
  },
  checkoutRequestID: {
    type: String
  }
}, { timestamps: true });

const SponsorRequest = mongoose.models.SponsorRequest || mongoose.model('SponsorRequest', sponsorRequestSchema);
module.exports = SponsorRequest;
