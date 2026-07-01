const mongoose = require('mongoose');

const checkoutRequestSchema = new mongoose.Schema({
  checkoutRequestId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  merchantRequestId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  amountKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

const CheckoutRequest = mongoose.models.CheckoutRequest || mongoose.model('CheckoutRequest', checkoutRequestSchema);
module.exports = CheckoutRequest;
