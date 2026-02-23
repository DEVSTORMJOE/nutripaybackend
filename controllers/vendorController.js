const MealPlan = require('../models/MealPlan');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');

// @desc    Get vendor dashboard stats
// @route   GET /api/vendor/dashboard
// @access  Private (Vendor)
const getDashboard = async (req, res) => {
  try {
    const plans = await MealPlan.countDocuments({ vendor: req.user.id });
    const activeSubs = await Subscription.countDocuments({
      plan: { $in: await MealPlan.find({ vendor: req.user.id }).select('_id') },
      status: 'active'
    });
    const wallet = await Wallet.findOne({ user: req.user.id });

    res.json({
      activePlans: plans,
      activeSubscriptions: activeSubs,
      balance: wallet ? wallet.balance : 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a meal plan
// @route   POST /api/vendor/mealplans
// @access  Private (Vendor)
const createMealPlan = async (req, res) => {
  const { name, price, description, meals } = req.body;

  try {
    const plan = await MealPlan.create({
      vendor: req.user.id,
      name,
      price,
      description,
      meals
    });

    res.status(201).json(plan);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get vendor meal plans
// @route   GET /api/vendor/mealplans
// @access  Private (Vendor)
const getMealPlans = async (req, res) => {
  try {
    const plans = await MealPlan.find({ vendor: req.user.id });
    res.json(plans);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get orders (Deliveries effectively)
// @route   GET /api/vendor/orders
// @access  Private (Vendor)
const getOrders = async (req, res) => {
  try {
    // Find deliveries related to verify subscriptions or direct orders
    // For simplicity, let's assume 'Delivery' model tracks "orders" for the day
    const deliveries = await Delivery.find({ vendor: req.user.id, status: { $ne: 'delivered' } })
      .populate('student', 'name email');

    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Update an order/delivery status
// @route   PUT /api/vendor/orders/:id
// @access  Private (Vendor)
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const delivery = await Delivery.findOne({ _id: id, vendor: req.user.id });
    if (!delivery) return res.status(404).json({ message: 'Order not found' });

    delivery.status = status;
    await delivery.save();

    res.json(delivery);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getDashboard,
  createMealPlan,
  getMealPlans,
  getOrders
  ,updateOrderStatus
};
