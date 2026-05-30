const mongoose = require('mongoose');

const weeklyPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    enum: ['essential', 'elite', 'ultimate'],
    required: true
  },
  week: {
    type: Number,
    enum: [1, 2, 3, 4],
    required: true,
    default: 1
  },
  day: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    required: true
  },
  breakfast: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meal',
    default: null
  },
  lunch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meal',
    default: null
  },
  supper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meal',
    default: null
  }
}, { timestamps: true });

weeklyPlanSchema.index({ planId: 1, week: 1, day: 1 }, { unique: true });

const WeeklyPlan = mongoose.models.WeeklyPlan || mongoose.model('WeeklyPlan', weeklyPlanSchema);
module.exports = WeeklyPlan;
