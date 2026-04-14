const mongoose = require('mongoose');

const WaitingListSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email']
  },
  phone: {
    type: String,
    required: true,
  },
  mealPlanPrice: {
    type: Number,
    required: true,
    min: [2000, 'Price must be at least 2000']
  },
  status: {
    type: String,
    enum: ['Pending', 'Contacted', 'Onboarded'],
    default: 'Pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WaitingList', WaitingListSchema);
