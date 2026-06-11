const mongoose = require('mongoose');

const nDashOrderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    estimatedPrice: { type: Number, required: true },
    notes: { type: String, default: "" }
  }],
  shoppingCost: {
    type: Number,
    required: true
  },
  platformFee: {
    type: Number,
    required: true
  },
  grandTotal: {
    type: Number,
    required: true
  },
  deliveryLocation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryLocation'
  },
  customLocation: {
    type: String
  },
  room: {
    type: String,
    required: true
  },
  deliveryAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['pending_payment', 'pending', 'accepted', 'shopping', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending_payment'
  },
  checkoutRequestID: {
    type: String,
    index: true
  },
  mpesaReceiptNumber: {
    type: String
  },
  deliveryVerificationCode: {
    type: String
  },
  deliveryVerificationExpiry: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, { timestamps: true });

const NDashOrder = mongoose.models.NDashOrder || mongoose.model('NDashOrder', nDashOrderSchema);
module.exports = NDashOrder;
