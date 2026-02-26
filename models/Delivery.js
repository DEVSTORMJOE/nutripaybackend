const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  sponsor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deliveryAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  items: [{
    name: String,
    quantity: Number
  }],
  status: {
    type: String,
    enum: ['awaiting_sponsor', 'pending', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled'],
    default: 'pending'
  },
  totalCost: {
    type: Number,
    required: true,
    default: 0
  },
  timeSlot: {
    type: String,
    enum: ['Breakfast', 'Lunch', 'Supper'],
    default: 'Lunch'
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  deliveredAt: Date,
  location: String
}, { timestamps: true });

const Delivery = mongoose.model('Delivery', deliverySchema);
module.exports = Delivery;
