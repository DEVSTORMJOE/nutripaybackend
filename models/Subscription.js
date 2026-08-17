const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  meal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meal'
  },
  sponsor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dailyCost: {
    type: mongoose.Schema.Types.Decimal128
  },
  planId: {
    type: String,
    default: 'essential'
  },
  totalPaidKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired', 'completed'],
    default: 'active'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'weekly'],
    default: 'monthly'
  },
  durationDays: {
    type: Number,
    default: 28
  }
}, { timestamps: true });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
module.exports = Subscription;
