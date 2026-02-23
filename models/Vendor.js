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
  mealPlans: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MealPlan'
  }]
}, { timestamps: true });

const Vendor = mongoose.model('Vendor', vendorSchema);
module.exports = Vendor;
