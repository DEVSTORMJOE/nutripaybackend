const mongoose = require('mongoose');

const mealChangeLogSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deliveryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery',
    required: true
  },
  originalMeal: {
    type: String,
    required: true
  },
  newMeal: {
    type: String,
    required: true
  },
  dailyBudget: {
    type: Number,
    required: true
  },
  approvalResult: {
    type: String,
    enum: ['Approved', 'Rejected'],
    required: true
  },
  reason: {
    type: String,
    default: ''
  }
}, { timestamps: true });

const MealChangeLog = mongoose.models.MealChangeLog || mongoose.model('MealChangeLog', mealChangeLogSchema);
module.exports = MealChangeLog;
