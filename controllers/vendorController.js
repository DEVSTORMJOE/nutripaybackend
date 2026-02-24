const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const stellarService = require('../services/stellarService');

// @desc    Get vendor dashboard stats
// @route   GET /api/vendor/dashboard
// @access  Private (Vendor)
const getDashboard = async (req, res) => {
  try {
    const plans = await Meal.countDocuments({ vendor: req.user.id });
    const activeSubs = await Subscription.countDocuments({
      meal: { $in: await Meal.find({ vendor: req.user.id }).select('_id') },
      status: 'active'
    });
    const wallet = await Wallet.findOne({ user: req.user.id });

    let balance = wallet ? wallet.balance : 0;

    // Fetch live balance from Stellar Network
    try {
      if (wallet && wallet.stellarPublicKey) {
        const liveXlmBalance = await stellarService.getBalance(wallet.stellarPublicKey);
        if (liveXlmBalance !== null) {
          const liveKesBalance = stellarService.XLM_to_KES(liveXlmBalance);
          
          if (!isNaN(liveKesBalance) && parseFloat(liveKesBalance) >= 0) {
              balance = parseFloat(liveKesBalance);
              wallet.balance = balance;
              await wallet.save();
          }
        }
      }
    } catch (stellarError) {
      console.error("Failed to fetch live Stellar balance, falling back to MongoDB cache:", stellarError);
    }

    res.json({
      activePlans: plans,
      activeSubscriptions: activeSubs,
      balance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a meal
// @route   POST /api/vendor/meals
// @access  Private (Vendor)
const createMeal = async (req, res) => {
  const { name, category, price, description, imageUrl, nutrition, currency } = req.body;

  try {
    const meal = await Meal.create({
      vendor: req.user.id,
      name,
      category,
      price,
      description,
      imageUrl,
      nutrition,
      currency: currency || "KES"
    });

    res.status(201).json(meal);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get vendor meals
// @route   GET /api/vendor/meals
// @access  Private (Vendor)
const getMeals = async (req, res) => {
  try {
    const meals = await Meal.find({ vendor: req.user.id });
    res.json(meals);
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

    // Payment Logic: If marking as 'delivered' from a 'pending'/'assigned'/'picked_up' state
    if (status === 'delivered' && delivery.status !== 'delivered') {
      const payoutKes = Number(delivery.totalCost || 0);
      
      if (payoutKes > 0) {
        // Find Admin Escrow Wallet and Vendor Wallet
        const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');
        const vendorWallet = await Wallet.findOne({ user: req.user.id });

        if (!adminWallet || !adminWallet.stellarSecretKey || !vendorWallet) {
          return res.status(500).json({ message: 'Wallet information missing. Cannot process vendor payout.' });
        }

        // Payout from Admin to Vendor
        const tx = await stellarService.makePayment(
          adminWallet.stellarSecretKey,
          vendorWallet.stellarPublicKey,
          payoutKes
        );

        // Log Payout Transaction
        await Transaction.create({
          fromWallet: adminWallet._id,
          toWallet: vendorWallet._id,
          amount: payoutKes,
          type: 'payout',
          stellarTxHash: tx.hash,
          description: `Payout for completed delivery ${delivery._id}`,
          status: 'completed'
        });

        // Update local balances
        adminWallet.balance -= payoutKes;
        await adminWallet.save();

        vendorWallet.balance += payoutKes;
        await vendorWallet.save();
      }
    }

    delivery.status = status;
    await delivery.save();

    res.json(delivery);
  } catch (error) {
    console.error("Update Order Status Error:", error);
    res.status(500).json({ message: 'Failed to update order and process payout: ' + (error.message || 'Unknown network error') });
  }
};

module.exports = {
  getDashboard,
  createMeal,
  getMeals,
  getOrders
  ,updateOrderStatus
};
