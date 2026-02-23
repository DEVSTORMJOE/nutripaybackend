const mongoose = require('mongoose');

const mealPlanSchema = new mongoose.Schema({
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  description: {
    type: String
  },
  meals: [{ // Array of meal names or objects
    day: String,
    meal: String
  }],
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  }
}, { timestamps: true });

const MealPlan = mongoose.model('MealPlan', mealPlanSchema);
module.exports = MealPlan;
