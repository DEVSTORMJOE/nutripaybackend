const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const walletService = require('../services/walletService');
const escrowService = require('../services/escrowService');

// @desc    Get student dashboard stats
// @route   GET /api/student/dashboard
// @access  Private (Student)
const getDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' }).populate('meal');
    const wallet = await walletService.getOrCreateWallet(studentId, 'student');

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

    res.json({
      balance: wallet.availableBalanceKES,
      availableBalanceKES: wallet.availableBalanceKES,
      lockedBalanceKES: wallet.lockedBalanceKES,
      subscription,
      todaysDelivery,
      upcomingDeliveriesCount,
      walletPublicKey: null
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

// @desc    Opt out of meal subscription and refund pending deliveries and wallet balance
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
    const pendingDeliveries = await Delivery.find({ student: studentId, status: 'pending' });

    // 1. Calculate and refund pending deliveries via Escrow Service (locks Escrow -> Treasury Stellar transaction inside)
    const pendingDeliveryIds = pendingDeliveries.map(d => d._id);
    const refundResult = await escrowService.calculateRefund(pendingDeliveryIds, studentId);

    // 2. Calculate Unused Wallet Balance Refund
    let sponsorId = null;
    if (subscription && subscription.sponsor) {
      sponsorId = subscription.sponsor;
    } else {
      const student = await User.findById(studentId).populate('linkedAccounts');
      if (student && student.linkedAccounts && student.linkedAccounts.length > 0) {
        const potentialSponsor = student.linkedAccounts.find(account => account.role === 'sponsor');
        if (potentialSponsor) sponsorId = potentialSponsor._id;
      }
    }

    let walletRefundToSponsor = 0;
    if (studentWallet.availableBalanceKES > 0 && sponsorId) {
      walletRefundToSponsor = studentWallet.availableBalanceKES;

      // Deduct student, credit sponsor internally (fiat level custodial sync)
      await walletService.debitWallet(
        studentId,
        walletRefundToSponsor,
        'refund',
        'wallet',
        `Refund unused student wallet balance to sponsor: ${sponsorId}`
      );

      await walletService.creditWallet(
        sponsorId,
        walletRefundToSponsor,
        'refund',
        'wallet',
        `Refund of unused sponsored student wallet balance`
      );

      // Notify Sponsor
      const Notification = require('../models/Notification');
      await Notification.create({
        user: sponsorId,
        type: 'system',
        title: 'Sponsorship Refund',
        message: `A sponsored student opted out. Unused student balance of ${walletRefundToSponsor} KES was refunded to your wallet.`
      });
    }

    if (subscription) {
      subscription.status = 'cancelled';
      subscription.endDate = Date.now();
      await subscription.save();
    }

    // Unfreeze Wallet
    studentWallet.status = 'active';
    await studentWallet.save();

    const totalRefund = (subscription?.sponsor ? refundResult.refundedKES : 0) + walletRefundToSponsor;

    res.json({ 
      message: `Successfully opted out. Please note that refunds are processed within 7 days. You will receive your remaining amount of KES ${totalRefund} thereafter.`, 
      refundedToSponsor: totalRefund, 
      refundedToStudent: subscription?.sponsor ? 0 : refundResult.refundedKES 
    });

  } catch (error) {
    console.error("Opt-out error:", error);
    try {
      if (req.user) await Wallet.updateOne({ user: req.user.id }, { $set: { status: 'active' } });
    } catch(e) {}
    res.status(500).json({ message: 'Server Error processing opt-out: ' + error.message });
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

// @desc    Cancel specific scheduled deliveries (Limit: 3/month - 1 breakfast, 1 lunch, 1 supper) and push by 1 day
// @route   POST /api/student/cancel-deliveries
// @access  Private (Student)
const cancelDeliveries = async (req, res) => {
  const { deliveryIds } = req.body;

  if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
    return res.status(400).json({ message: 'No deliveries selected for cancellation.' });
  }

  try {
    const studentId = req.user.id;
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: studentId });
    if (!studentProfile) return res.status(404).json({ message: 'Student profile not found.' });

    // Check & Reset monthly counts
    const currentMonth = new Date().getMonth();
    if (studentProfile.cancellationResetMonth !== currentMonth) {
      studentProfile.cancelledBreakfastCount = 0;
      studentProfile.cancelledLunchCount = 0;
      studentProfile.cancelledSupperCount = 0;
      studentProfile.cancellationResetMonth = currentMonth;
    }

    // Process cancellations
    const deliveries = await Delivery.find({ _id: { $in: deliveryIds }, student: studentId, status: 'pending' });
    if (deliveries.length === 0) {
      return res.status(404).json({ message: "No pending scheduled meals found for these IDs." });
    }

    for (let d of deliveries) {
      const slot = d.timeSlot;
      if (slot === 'Breakfast') {
        if (studentProfile.cancelledBreakfastCount >= 1) {
          return res.status(400).json({ message: "You have already cancelled 1 Breakfast this month. Limit reached." });
        }
        studentProfile.cancelledBreakfastCount++;
      } else if (slot === 'Lunch') {
        if (studentProfile.cancelledLunchCount >= 1) {
          return res.status(400).json({ message: "You have already cancelled 1 Lunch this month. Limit reached." });
        }
        studentProfile.cancelledLunchCount++;
      } else if (slot === 'Supper') {
        if (studentProfile.cancelledSupperCount >= 1) {
          return res.status(400).json({ message: "You have already cancelled 1 Supper this month. Limit reached." });
        }
        studentProfile.cancelledSupperCount++;
      }

      // Mark cancelled
      d.status = 'cancelled';
      await d.save();

      // Extend subscription and schedule a new delivery 1 day after expiry
      const subscription = await Subscription.findOne({ student: studentId, status: 'active' });
      let currentExpiry = subscription ? subscription.endDate : new Date();
      if (!currentExpiry) currentExpiry = new Date();

      const newExpiry = new Date(currentExpiry.getTime() + 24 * 60 * 60 * 1000);
      if (subscription) {
        subscription.endDate = newExpiry;
        await subscription.save();
      }

      // Schedule the replacement meal on the new expiry date
      await Delivery.create({
        student: studentId,
        vendor: d.vendor,
        sponsor: d.sponsor || null,
        items: d.items,
        status: 'pending',
        totalCost: d.totalCost,
        timeSlot: d.timeSlot,
        scheduledDate: newExpiry,
        location: d.location
      });
    }

    await studentProfile.save();

    res.json({ 
      message: `Successfully cancelled and extended your subscription by ${deliveries.length} day(s). Replacement meals have been scheduled.`
    });

  } catch (error) {
    console.error("Cancel Deliveries Error:", error);
    res.status(500).json({ message: 'Failed to process cancellation: ' + error.message });
  }
};

// @desc    Donate a scheduled meal to help vulnerable students
// @route   POST /api/student/donate
// @access  Private (Student)
const donateDelivery = async (req, res) => {
  const { deliveryId } = req.body;
  try {
    const studentId = req.user.id;
    const delivery = await Delivery.findOne({ _id: deliveryId, student: studentId, status: 'pending' });
    if (!delivery) return res.status(404).json({ message: "Pending delivery not found or already processed." });

    delivery.status = 'donated';
    delivery.isDonated = true;
    delivery.originalStudent = studentId;
    await delivery.save();

    res.json({ success: true, message: "Your meal has been donated to the public Donation Box! Thank you for your kindness." });
  } catch (e) {
    res.status(500).json({ message: "Failed to donate meal: " + e.message });
  }
};

// @desc    Get list of all donated meals currently unclaimed
// @route   GET /api/student/donated-meals
// @access  Private (Student)
const getDonatedMeals = async (req, res) => {
  try {
    const meals = await Delivery.find({ status: 'donated' })
      .populate('student', 'name')
      .populate({
        path: 'vendor',
        populate: { path: 'user', select: 'name' }
      })
      .sort({ scheduledDate: 1 });
    res.json(meals);
  } catch (e) {
    res.status(500).json({ message: "Failed to load donated meals." });
  }
};

// @desc    Claim a donated meal for a vulnerable student
// @route   POST /api/student/claim-meal
// @access  Private (Student)
const claimDonatedMeal = async (req, res) => {
  const { deliveryId } = req.body;
  try {
    const studentId = req.user.id;
    const delivery = await Delivery.findOne({ _id: deliveryId, status: 'donated' });
    if (!delivery) return res.status(404).json({ message: "Donated meal not found or already claimed." });

    if (delivery.originalStudent.toString() === studentId) {
      return res.status(400).json({ message: "You cannot claim your own donated meal." });
    }

    delivery.student = studentId;
    delivery.status = 'pending';
    delivery.claimedAt = new Date();
    
    // Assign location to claimant's student profile campus/hostel
    const Student = require('../models/Student');
    const claimantProfile = await Student.findOne({ user: studentId }).populate('deliveryLocation');
    if (claimantProfile && claimantProfile.deliveryLocation) {
      delivery.location = claimantProfile.deliveryLocation.name || 'Campus';
    }

    await delivery.save();

    res.json({ success: true, message: "Meal successfully claimed! It has been scheduled for your delivery." });
  } catch (e) {
    res.status(500).json({ message: "Failed to claim meal: " + e.message });
  }
};

const shuffleMeal = async (req, res) => {
  const { deliveryId, newMealId } = req.body;
  try {
    const studentId = req.user.id;
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: studentId });
    if (!studentProfile) return res.status(404).json({ message: 'Student profile not found.' });

    // 1. Enforce monthly limit of 3 shuffles
    const currentMonth = new Date().getMonth();
    if (studentProfile.cancellationResetMonth !== currentMonth) {
      studentProfile.shufflesCount = 0;
      studentProfile.cancellationResetMonth = currentMonth;
    }

    if (studentProfile.shufflesCount >= 3) {
      return res.status(400).json({ message: "You have reached the maximum limit of 3 shuffles per month." });
    }

    // 2. Query delivery and verify
    const delivery = await Delivery.findOne({ _id: deliveryId, student: studentId, status: 'pending' });
    if (!delivery) return res.status(404).json({ message: "Pending scheduled delivery not found." });

    // 3. Find target meal details
    const newMeal = await Meal.findById(newMealId);
    if (!newMeal || newMeal.approvalStatus !== 'approved') {
      return res.status(400).json({ message: "Target meal is not approved or does not exist." });
    }

    // 4. Enforce Meal Population Protection Rule
    // Find total active subscriptions on the student's plan tier
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' });
    if (!subscription) return res.status(400).json({ message: "No active subscription found to perform shuffles." });

    const planId = subscription.planId;
    const totalSubscribers = await Subscription.countDocuments({ status: 'active', planId });
    const threshold = Math.max(1, Math.floor(totalSubscribers / 3));

    // Count how many deliveries currently scheduled on this day & slot have the original meal
    const originalMealName = delivery.items?.[0]?.name;
    if (originalMealName) {
      const currentOriginalMealCount = await Delivery.countDocuments({
        scheduledDate: delivery.scheduledDate,
        timeSlot: delivery.timeSlot,
        status: 'pending',
        "items.name": originalMealName
      });

      if (currentOriginalMealCount <= threshold) {
        return res.status(400).json({
          message: "This meal cannot be selected because the minimum production threshold would be violated."
        });
      }
    }

    // 5. Update delivery and save
    delivery.items = [{ name: newMeal.name, quantity: 1 }];
    delivery.vendor = newMeal.vendor;
    await delivery.save();

    // 6. Track shuffle usage
    studentProfile.shufflesCount++;
    studentProfile.lastShuffleDate = new Date();
    await studentProfile.save();

    res.json({
      success: true,
      message: "Meal successfully shuffled!",
      delivery
    });
  } catch (error) {
    console.error("Shuffle Meal Error:", error);
    res.status(500).json({ message: "Failed to shuffle meal: " + error.message });
  }
};

module.exports = {
  getDashboard,
  selectMeal,
  optOut,
  getDeliverySchedule,
  cancelDeliveries,
  donateDelivery,
  getDonatedMeals,
  claimDonatedMeal,
  shuffleMeal
};
