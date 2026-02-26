const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const stellarService = require('../services/stellarService');

// @desc    Get student dashboard stats
// @route   GET /api/student/dashboard
// @access  Private (Student)
const getDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' }).populate('meal');
    const wallet = await Wallet.findOne({ user: studentId });

    // Fetch deliveries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todaysDeliveries = await Delivery.find({
      student: studentId,
      scheduledDate: { $gte: today, $lte: endOfDay },
    }).sort({ scheduledDate: 1 }).lean();

    let todaysDelivery = null;
    if (todaysDeliveries.length > 0) {
      todaysDelivery = {
        ...todaysDeliveries[0],
        items: todaysDeliveries.flatMap(d => d.items)
      };
    }

    const upcomingDeliveriesCount = await Delivery.countDocuments({
      student: studentId,
      scheduledDate: { $gte: today },
      status: { $in: ['pending', 'assigned'] }
    });

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
      balance,
      subscription,
      todaysDelivery,
      upcomingDeliveriesCount,
      walletPublicKey: wallet ? wallet.stellarPublicKey : null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Select a meal
// @route   POST /api/student/select-meal
// @access  Private (Student)
const selectMeal = async (req, res) => {
  const { mealId, sponsorId } = req.body;

  try {
    const meal = await Meal.findById(mealId);
    if (!meal) return res.status(404).json({ message: 'Meal not found' });

    // Check if already subscribed
    const existing = await Subscription.findOne({ student: req.user.id, status: 'active' });
    if (existing) return res.status(400).json({ message: 'Already subscribed to a meal' });

    const subscription = await Subscription.create({
      student: req.user.id,
      meal: mealId,
      sponsor: sponsorId || null,
      dailyCost: meal.price
    });

    // Link accounts
    if (sponsorId) {
      await User.findByIdAndUpdate(sponsorId, {
        $addToSet: { linkedAccounts: req.user.id }
      });
      await User.findByIdAndUpdate(req.user.id, {
        $addToSet: { linkedAccounts: sponsorId }
      });
    }

    res.status(201).json(subscription);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Opt out of meal subscription and refund pending deliveries
// @route   POST /api/student/opt-out
// @access  Private (Student)
const optOut = async (req, res) => {
  try {
    const studentId = req.user.id;
    const studentWallet = await Wallet.findOne({ user: studentId });
    if (!studentWallet) return res.status(404).json({ message: 'Student wallet not found' });

    // Freeze Wallet to prevent race conditions
    studentWallet.status = 'refund_pending';
    await studentWallet.save();

    const subscription = await Subscription.findOne({ student: studentId, status: 'active' });
    if (!subscription) {
      // Unfreeze and return
      studentWallet.status = 'active';
      await studentWallet.save();
      return res.status(400).json({ message: 'No active subscription' });
    }

    const pendingDeliveries = await Delivery.find({
      student: studentId,
      status: 'pending'
    });

    let totalRefundToSponsor = 0;
    let sponsorId = null;
    let totalRefundToStudent = 0;

    pendingDeliveries.forEach(d => {
      if (d.sponsor) {
        totalRefundToSponsor += Number(d.totalCost || 0);
        sponsorId = d.sponsor;
      } else {
        totalRefundToStudent += Number(d.totalCost || 0);
      }
    });

    const validDeliveryIds = pendingDeliveries.map(d => d._id);

    if (totalRefundToSponsor > 0 || totalRefundToStudent > 0) {
      const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');
      if (!adminWallet || !adminWallet.stellarSecretKey) {
        studentWallet.status = 'active';
        await studentWallet.save();
        return res.status(500).json({ message: 'Escrow (Admin) wallet missing.' });
      }

      // Refund Sponsor
      if (totalRefundToSponsor > 0 && sponsorId) {
        const sponsorWallet = await Wallet.findOne({ user: sponsorId });
        if (sponsorWallet) {
          const tx1 = await stellarService.makePayment(adminWallet.stellarSecretKey, sponsorWallet.stellarPublicKey, totalRefundToSponsor);
          
          await Transaction.create({
            fromWallet: adminWallet._id,
            toWallet: sponsorWallet._id,
            amount: totalRefundToSponsor,
            type: 'refund',
            stellarTxHash: tx1.hash,
            description: `Refund for opted-out student deliveries`,
            status: 'completed'
          });

          sponsorWallet.balance += totalRefundToSponsor;
          await sponsorWallet.save();
          adminWallet.balance -= totalRefundToSponsor;

          // Notify Sponsor
          const Notification = require('../models/Notification');
          await Notification.create({
            user: sponsorId,
            type: 'system',
            title: 'Sponsorship Refund',
            message: `A sponsored student opted out. ${totalRefundToSponsor} KES was refunded to your wallet.`
          });
        }
      }

      // Refund Student
      if (totalRefundToStudent > 0) {
        const tx2 = await stellarService.makePayment(adminWallet.stellarSecretKey, studentWallet.stellarPublicKey, totalRefundToStudent);
        
        await Transaction.create({
          fromWallet: adminWallet._id,
          toWallet: studentWallet._id,
          amount: totalRefundToStudent,
          type: 'refund',
          stellarTxHash: tx2.hash,
          description: `Refund for opted-out deliveries`,
          status: 'completed'
        });

        studentWallet.balance += totalRefundToStudent;
        adminWallet.balance -= totalRefundToStudent;
      }

      await adminWallet.save();
    }

    subscription.status = 'cancelled';
    subscription.endDate = Date.now();
    await subscription.save();

    if (validDeliveryIds.length > 0) {
      await Delivery.updateMany({ _id: { $in: validDeliveryIds } }, { $set: { status: 'cancelled' } });
    }

    // Unfreeze Wallet
    studentWallet.status = 'active';
    await studentWallet.save();

    res.json({ 
      message: 'Successfully opted out of the meal plan. Refunds processed.', 
      refundedToSponsor: totalRefundToSponsor, 
      refundedToStudent: totalRefundToStudent 
    });

  } catch (error) {
    console.error(error);
    // Unfreeze as failsafe (could be error handler in real production env)
    try {
      if (req.user) await Wallet.updateOne({ user: req.user.id }, { $set: { status: 'active' } });
    } catch(e) {}
    res.status(500).json({ message: 'Server Error processing opt-out.' });
  }
};

// @desc    Get student's upcoming delivery schedule
// @route   GET /api/student/schedule
// @access  Private (Student)
const getDeliverySchedule = async (req, res) => {
  try {
    const deliveries = await Delivery.find({ student: req.user.id }).sort({ scheduledDate: 1 });
    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Cancel specific scheduled deliveries and get a refund
// @route   POST /api/student/cancel-deliveries
// @access  Private (Student)
const cancelDeliveries = async (req, res) => {
  const { deliveryIds } = req.body;

  if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
    return res.status(400).json({ message: 'No deliveries selected for cancellation.' });
  }

  try {
    const studentId = req.user.id;
    const studentWallet = await Wallet.findOne({ user: studentId });
    if (!studentWallet) return res.status(404).json({ message: 'Student wallet not found' });

    // Freeze Wallet
    studentWallet.status = 'refund_pending';
    await studentWallet.save();

    // 1. Fetch the targeted pending deliveries
    const deliveries = await Delivery.find({
      _id: { $in: deliveryIds },
      student: studentId,
      status: 'pending' // Only allow cancelling pending deliveries
    });

    if (deliveries.length === 0) {
      studentWallet.status = 'active';
      await studentWallet.save();
      return res.status(400).json({ message: 'No eligible pending deliveries found to cancel.' });
    }

    // 2. Calculate Refund Total split by funder
    let totalRefundToSponsor = 0;
    let totalRefundToStudent = 0;
    const sponsorMap = {}; // Maps sponsorId to amount, in case of multiple sponsors somehow
    const validDeliveryIds = [];

    deliveries.forEach(d => {
      validDeliveryIds.push(d._id);
      if (d.sponsor) {
        totalRefundToSponsor += Number(d.totalCost || 0);
        const sIdStr = d.sponsor.toString();
        if(!sponsorMap[sIdStr]) sponsorMap[sIdStr] = 0;
        sponsorMap[sIdStr] += Number(d.totalCost || 0);
      } else {
        totalRefundToStudent += Number(d.totalCost || 0);
      }
    });

    if (totalRefundToSponsor <= 0 && totalRefundToStudent <= 0) {
      await Delivery.updateMany({ _id: { $in: validDeliveryIds } }, { $set: { status: 'cancelled' } });
      studentWallet.status = 'active';
      await studentWallet.save();
      return res.json({ message: 'Deliveries cancelled. No refund required.', refunded: 0, count: validDeliveryIds.length });
    }

    // 3. Process Stellar Refund from Escrow (Admin)
    const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');

    if (!adminWallet || !adminWallet.stellarSecretKey) {
      studentWallet.status = 'active';
      await studentWallet.save();
      return res.status(500).json({ message: 'Escrow (Admin) wallet missing.' });
    }

    // Refund Sponsors
    const Notification = require('../models/Notification');
    for (const [sId, amount] of Object.entries(sponsorMap)) {
      if (amount > 0) {
        const sponsorWallet = await Wallet.findOne({ user: sId });
        if (sponsorWallet) {
          const tx1 = await stellarService.makePayment(adminWallet.stellarSecretKey, sponsorWallet.stellarPublicKey, amount);
          
          await Transaction.create({
            fromWallet: adminWallet._id,
            toWallet: sponsorWallet._id,
            amount: amount,
            type: 'refund',
            stellarTxHash: tx1.hash,
            description: `Refund for cancelled student deliveries`,
            status: 'completed'
          });

          sponsorWallet.balance += amount;
          await sponsorWallet.save();
          adminWallet.balance -= amount;

          await Notification.create({
            user: sId,
            type: 'system',
            title: 'Meal Cancellation Refund',
            message: `A student cancelled a funded meal. ${amount} KES was refunded to your wallet.`
          });
        }
      }
    }

    // Refund Student
    if (totalRefundToStudent > 0) {
      const tx2 = await stellarService.makePayment(adminWallet.stellarSecretKey, studentWallet.stellarPublicKey, totalRefundToStudent);
      
      await Transaction.create({
        fromWallet: adminWallet._id,
        toWallet: studentWallet._id,
        amount: totalRefundToStudent,
        type: 'refund',
        stellarTxHash: tx2.hash,
        description: `Refund for cancelled deliveries`,
        status: 'completed'
      });

      studentWallet.balance += totalRefundToStudent;
      adminWallet.balance -= totalRefundToStudent;
    }

    await adminWallet.save();

    // 6. Update Delivery Statuses
    await Delivery.updateMany({ _id: { $in: validDeliveryIds } }, { $set: { status: 'cancelled' } });

    // Unfreeze Wallet
    studentWallet.status = 'active';
    await studentWallet.save();

    res.json({ 
      message: `Successfully cancelled ${validDeliveryIds.length} deliveries.`, 
      refundedToSponsor: totalRefundToSponsor, 
      refundedToStudent: totalRefundToStudent,
      newBalance: studentWallet.balance
    });

  } catch (error) {
    console.error("Cancel Deliveries Error:", error);
    try {
      if (req.user) await Wallet.updateOne({ user: req.user.id }, { $set: { status: 'active' } });
    } catch(e) {}
    res.status(500).json({ message: 'Failed to process cancellation and refund: ' + (error.message || 'Unknown network error') });
  }
};

module.exports = {
  getDashboard,
  selectMeal,
  optOut,
  getDeliverySchedule,
  cancelDeliveries
};
