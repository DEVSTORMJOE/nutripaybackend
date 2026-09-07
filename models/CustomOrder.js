const mongoose = require('mongoose');

const customOrderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Null for guest checkout
  },
  guestCheckout: {
    type: Boolean,
    default: false
  },
  guestDetails: {
    name: String,
    phone: String,
    deliveryLocation: String
  },
  deliveryNote: {
    type: String,
    default: ""
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  items: [{
    name: String,
    quantity: Number,
    price: Number
  }],
  totalCost: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['wallet', 'mpesa_direct'],
    required: true
  },
  paymentSource: {
    type: String,
    enum: ['sponsor_funds', 'student_wallet', 'mpesa_direct']
  },
  checkoutRequestID: {
    type: String, // Tracks STK push reference
    index: true
  },
  status: {
    type: String,
    enum: [
      'pending_payment',
      'preparing',
      'ready',
      'assigned',
      'picked_up',
      'delivered',
      'failed',
      'cancelled'
    ],
    default: 'pending_payment'
  },
  deliveryLocation: {
    type: String
  },
  deliveryAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

const CustomOrder = mongoose.models.CustomOrder || mongoose.model('CustomOrder', customOrderSchema);
module.exports = CustomOrder;
