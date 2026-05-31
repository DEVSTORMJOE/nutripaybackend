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
    type: Number
  },
  planId: {
    type: String,
    default: 'essential'
  },
  totalPaidKES: {
    type: Number,
    default: 0
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
    enum: ['active', 'cancelled', 'expired'],
    default: 'active'
  }
}, { timestamps: true });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
module.exports = Subscription;
