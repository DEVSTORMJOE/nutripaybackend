const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
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
    const studentProfile = await Student.findOne({ user: studentId });

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

    const mealsDonated = await Delivery.countDocuments({ originalStudent: studentId, isDonated: true });
    const mealsClaimed = await Delivery.countDocuments({ student: studentId, claimedAt: { $exists: true, $ne: null } });
    const availableDonations = await Delivery.countDocuments({ status: 'donated' });

    res.json({
      balance: wallet.availableBalanceKES,
      availableBalanceKES: wallet.availableBalanceKES,
      lockedBalanceKES: wallet.lockedBalanceKES,
      subscription,
      todaysDelivery,
      upcomingDeliveriesCount,
      walletPublicKey: null,
      shufflesCount: studentProfile ? (studentProfile.shufflesCount || 0) : 0,
      donationStats: {
        mealsDonated,
        mealsClaimed,
        availableDonations
      }
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

    // Find active subscription
    const subscription = await Subscription.findOne({ student: studentId, status: 'active' });
    
    // Find unfulfilled deliveries
    const pendingDeliveries = await Delivery.find({
      student: studentId,
      status: { $in: ['pending', 'assigned', 'preparing', 'ready'] }
    });

    if (!subscription && pendingDeliveries.length === 0) {
      return res.status(400).json({ message: 'No active subscription or unfulfilled deliveries to opt out from.' });
    }

    // Freeze Wallet to show 'refund_pending' progress banner on frontend
    studentWallet.status = 'refund_pending';
    await studentWallet.save();

    // Sum unfulfilled delivery costs
    let totalRefundKes = 0;
    const pendingDeliveryIds = [];
    let sponsorId = subscription?.sponsor || null;

    pendingDeliveries.forEach(d => {
      totalRefundKes += Number(d.totalCost || 0);
      pendingDeliveryIds.push(d._id);
      if (d.sponsor && !sponsorId) {
        sponsorId = d.sponsor;
      }
    });

    // Fallback sponsor lookups if not found on subscription
    if (!sponsorId) {
      const studentObj = await User.findById(studentId).populate('linkedAccounts');
      if (studentObj && studentObj.linkedAccounts && studentObj.linkedAccounts.length > 0) {
        const potentialSponsor = studentObj.linkedAccounts.find(account => account.role === 'sponsor');
        if (potentialSponsor) sponsorId = potentialSponsor._id;
      }
    }

    // Cancel deliveries immediately to halt service
    if (pendingDeliveryIds.length > 0) {
      await Delivery.updateMany(
        { _id: { $in: pendingDeliveryIds } },
        { $set: { status: 'cancelled' } }
      );
    }

    // Cancel subscription
    if (subscription) {
      subscription.status = 'cancelled';
      subscription.endDate = Date.now();
      await subscription.save();
    }

    // Create Refund Request
    const RefundRequest = require('../models/RefundRequest');
    const refundRequest = await RefundRequest.create({
      student: studentId,
      amountKES: totalRefundKes,
      fundingType: sponsorId ? 'sponsor' : 'self',
      sponsor: sponsorId,
      subscription: subscription ? subscription._id : null,
      deliveryIds: pendingDeliveryIds,
      status: 'pending_admin_approval'
    });

    res.json({
      message: `Opt-out request submitted. Your refund request of KES ${totalRefundKes} is pending admin approval.`,
      refundRequest
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
          message: "This meal cannot be selected because the minimum preparation threshold would be violated."
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

const getStudentDailyBudget = async (studentId) => {
  const Subscription = require('../models/Subscription');
  const SystemSettings = require('../models/SystemSettings');
  
  const sub = await Subscription.findOne({ student: studentId, status: 'active' });
  if (!sub) return 150; // default/fallback
  
  if (sub.planId && sub.planId !== 'custom') {
    const tier = sub.planId.toLowerCase();
    let settingKey = 'essential_price';
    let defaultVal = 3500;
    if (tier.includes('elite')) {
      settingKey = 'elite_price';
      defaultVal = 4500;
    } else if (tier.includes('ultimate')) {
      settingKey = 'ultimate_price';
      defaultVal = 6000;
    }
    const priceSetting = await SystemSettings.findOne({ key: settingKey });
    const monthlyPrice = priceSetting ? priceSetting.value : defaultVal;
    return Number((monthlyPrice / 28).toFixed(2));
  }
  
  if (sub.planId === 'custom') {
    if (sub.totalPaidKES) {
      const days = Math.ceil((new Date(sub.endDate) - new Date(sub.startDate)) / (1000 * 60 * 60 * 24)) || 28;
      return Number((sub.totalPaidKES / days).toFixed(2));
    }
  }
  
  return sub.dailyCost || 150;
};

// @desc    Get all approved meals that cost less than or equal to the student's daily budget
// @route   GET /api/student/meal-change-alternatives
// @access  Private (Student)
const getMealChangeAlternatives = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { deliveryId } = req.query;
    
    if (!deliveryId) {
      return res.status(400).json({ message: "deliveryId is required" });
    }
    
    const delivery = await Delivery.findOne({ _id: deliveryId, student: studentId });
    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }
    
    const dailyBudget = await getStudentDailyBudget(studentId);
    
    // Fetch all approved meals with price <= dailyBudget
    const meals = await Meal.find({
      approvalStatus: 'approved',
      price: { $lte: dailyBudget }
    }).populate({
      path: 'vendor',
      populate: { path: 'user', select: 'name email' }
    });
    
    res.json({ dailyBudget, meals });
  } catch (error) {
    console.error("Get Meal Change Alternatives Error:", error);
    res.status(500).json({ message: "Failed to fetch meal alternatives" });
  }
};

// @desc    Change a scheduled meal
// @route   POST /api/student/meal-change
// @access  Private (Student)
const changeMeal = async (req, res) => {
  const { deliveryId, newMealId } = req.body;
  
  try {
    const studentId = req.user.id;
    const MealChangeLog = require('../models/MealChangeLog');
    const fs = require('fs');
    const path = require('path');
    
    // 1. Query delivery and verify
    const delivery = await Delivery.findOne({ _id: deliveryId, student: studentId });
    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found." });
    }
    
    // Verify status is strictly pending
    if (delivery.status !== 'pending') {
      return res.status(400).json({ message: "Only pending deliveries can be changed." });
    }
    
    // 2. Check restriction: Max 1 change per day (query MealChangeLog for today)
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayEnd = new Date();
    todayEnd.setHours(23,59,59,999);
    
    const existingChange = await MealChangeLog.findOne({
      student: studentId,
      deliveryId: deliveryId,
      createdAt: { $gte: todayStart, $lte: todayEnd },
      approvalResult: 'Approved'
    });
    
    if (existingChange) {
      return res.status(400).json({ message: "You can only make 1 meal change per day for a scheduled delivery." });
    }
    
    // 3. Cutoff Check: At least 2 hours before delivery time
    // Breakfast = 5:00 AM cutoff, Lunch = 10:00 AM cutoff, Supper = 4:00 PM cutoff
    const deliveryDate = new Date(delivery.scheduledDate);
    const cutoffDate = new Date(deliveryDate);
    if (delivery.timeSlot === 'Breakfast') {
      cutoffDate.setHours(5, 0, 0, 0);
    } else if (delivery.timeSlot === 'Lunch') {
      cutoffDate.setHours(10, 0, 0, 0);
    } else if (delivery.timeSlot === 'Supper') {
      cutoffDate.setHours(16, 0, 0, 0);
    } else {
      cutoffDate.setTime(deliveryDate.getTime() - 2 * 60 * 60 * 1000);
    }
    
    if (Date.now() > cutoffDate.getTime()) {
      await MealChangeLog.create({
        student: studentId,
        deliveryId,
        originalMeal: delivery.items?.[0]?.name || 'Unknown',
        newMeal: 'N/A',
        dailyBudget: 0,
        approvalResult: 'Rejected',
        reason: 'Cutoff time has passed'
      });
      return res.status(400).json({ message: "Cutoff time has passed. Meals cannot be changed within 2 hours of delivery window." });
    }
    
    // 4. Find new meal
    const newMeal = await Meal.findById(newMealId);
    if (!newMeal || newMeal.approvalStatus !== 'approved') {
      return res.status(400).json({ message: "Target meal is not approved or does not exist." });
    }
    
    // 5. Daily budget check
    const dailyBudget = await getStudentDailyBudget(studentId);
    if (newMeal.price > dailyBudget) {
      await MealChangeLog.create({
        student: studentId,
        deliveryId,
        originalMeal: delivery.items?.[0]?.name || 'Unknown',
        newMeal: newMeal.name,
        dailyBudget,
        approvalResult: 'Rejected',
        reason: `Meal price ${newMeal.price} KES exceeds daily budget of ${dailyBudget} KES`
      });
      return res.status(400).json({ message: `Meal price exceeds daily budget of ${dailyBudget} KES` });
    }
    
    // 6. Perform swap
    const originalMealName = delivery.items?.[0]?.name || 'Unknown';
    delivery.items = [{ name: newMeal.name, quantity: 1 }];
    delivery.vendor = newMeal.vendor;
    await delivery.save();
    
    // Log to MealChangeLog Mongoose collection
    const changeLog = await MealChangeLog.create({
      student: studentId,
      deliveryId,
      originalMeal: originalMealName,
      newMeal: newMeal.name,
      dailyBudget,
      approvalResult: 'Approved',
      reason: `Meal changed successfully from ${originalMealName} to ${newMeal.name}`
    });
    
    // Log to meal_changes.log file
    const logFilePath = path.join(__dirname, '../meal_changes.log');
    fs.appendFileSync(logFilePath, JSON.stringify(changeLog) + "\n");
    
    res.json({
      success: true,
      message: "Meal changed successfully!",
      delivery
    });
  } catch (error) {
    console.error("Meal Change Error:", error);
    res.status(500).json({ message: "Failed to change meal: " + error.message });
  }
};

// @desc    Get refund requests for the authenticated student
// @route   GET /api/student/my-refund-requests
// @access  Private (Student)
const getMyRefundRequests = async (req, res) => {
  try {
    const RefundRequest = require('../models/RefundRequest');
    const refunds = await RefundRequest.find({ student: req.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(refunds);
  } catch (error) {
    console.error('Get My Refund Requests Error:', error);
    res.status(500).json({ message: 'Server Error fetching refund requests' });
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
  shuffleMeal,
  getMealChangeAlternatives,
  changeMeal,
  getMyRefundRequests,
};

