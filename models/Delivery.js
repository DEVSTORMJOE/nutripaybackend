const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
    enum: ['pending', 'assigned', 'picked_up', 'delivered', 'failed'],
    default: 'pending'
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
