const MealPlan = require('../models/MealPlan');

// @desc    Get approved meal plans for public listing
// @route   GET /api/mealplans
// @access  Public
const getPublicMealPlans = async (req, res) => {
  try {
    const plans = await MealPlan.find({ approvalStatus: 'approved' }).populate('vendor', 'name');
    res.json(plans);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getPublicMealPlans };
