const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stellarPublicKey: {
    type: String,
    required: true
  },
  approvedStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  meals: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meal'
  }],
  deliveryStaff: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  locations: [{
    name: String,
    address: String,
    hours: String,
    status: { type: String, enum: ['Open', 'Closed'], default: 'Open' }
  }]
}, { timestamps: true });

const Vendor = mongoose.model('Vendor', vendorSchema);
module.exports = Vendor;
