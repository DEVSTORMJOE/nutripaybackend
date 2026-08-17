const Subscription = require('../models/Subscription');
const Delivery = require('../models/Delivery');
const Student = require('../models/Student');

/**
 * Checks all active subscriptions for a student and auto-completes any subscription
 * where all scheduled deliveries are fulfilled/terminal (delivered, cancelled, failed) OR
 * where 0 unfulfilled deliveries remain for the subscription.
 * 
 * Unfulfilled statuses: ['awaiting_sponsor', 'pending', 'preparing', 'ready', 'assigned', 'picked_up']
 * 
 * Returns the active subscription object (if any active subscription remains), or null.
 */
const checkAndAutoCompleteSubscriptions = async (studentId) => {
  if (!studentId) return null;

  try {
    const activeSubs = await Subscription.find({ student: studentId, status: 'active' });

    for (const sub of activeSubs) {
      // Find count of unfulfilled deliveries linked to this subscription or scheduled during its active dates
      const unfulfilledCount = await Delivery.countDocuments({
        student: studentId,
        $or: [
          { subscription: sub._id },
          { subscription: { $exists: false }, scheduledDate: { $gte: sub.startDate, $lte: sub.endDate } }
        ],
        status: { $in: ['awaiting_sponsor', 'pending', 'preparing', 'ready', 'assigned', 'picked_up'] }
      });

      // If no unfulfilled deliveries remain, mark this subscription as completed
      if (unfulfilledCount === 0) {
        sub.status = 'completed';
        sub.endDate = sub.endDate || new Date();
        await sub.save();
        console.log(`[Subscription Service] Subscription ${sub._id} (${sub.planId}) for student ${studentId} marked as completed (0 unfulfilled deliveries remaining).`);
      }
    }

    // Check if any active subscription still exists
    const remainingActiveSub = await Subscription.findOne({ student: studentId, status: 'active' }).populate('meal');

    // Keep Student profile subscriptionActive flag strictly in sync
    await Student.updateOne(
      { user: studentId },
      { $set: { subscriptionActive: !!remainingActiveSub } }
    );

    return remainingActiveSub;
  } catch (err) {
    console.error("[Subscription Service Error]:", err);
    try {
      return await Subscription.findOne({ student: studentId, status: 'active' }).populate('meal');
    } catch (_) {
      return null;
    }
  }
};

/**
 * Creates a custom plan subscription, locks escrow funds, and schedules delivery records.
 * Used by both direct wallet checkout and M-Pesa STK push callback handlers.
 */
const createCustomPlanSubscription = async ({
  userId,
  totalCost,
  daysCount,
  startDate,
  breakfast,
  lunch,
  supper,
  breakfastMealId,
  lunchMealId,
  supperMealId,
  customSchedule,
  sponsorId = null,
  session = null
}) => {
  // 1. Lock subscription funds via Escrow Service
  const escrowService = require('./escrowService');
  await escrowService.lockSubscriptionFunds(userId, totalCost, sponsorId, session);

  // 2. Set Student profile active
  const studentProfile = session
    ? await Student.findOne({ user: userId }).populate('deliveryLocation').session(session)
    : await Student.findOne({ user: userId }).populate('deliveryLocation');

  if (studentProfile) {
    studentProfile.subscriptionActive = true;
    await studentProfile.save(session ? { session } : {});
  }

  // 3. Create Subscription document
  const today = startDate ? new Date(startDate) : new Date();
  const endDate = new Date(today.getTime() + daysCount * 24 * 60 * 60 * 1000);
  const subDocs = [{
    student: userId,
    sponsor: sponsorId,
    planId: 'custom',
    status: 'active',
    startDate: today,
    endDate: endDate,
    totalPaidKES: totalCost
  }];

  const createdSubs = session
    ? await Subscription.create(subDocs, { session })
    : await Subscription.create(subDocs);
  const subscription = createdSubs[0];

  // 4. Schedule deliveries
  if (session) {
    await Delivery.deleteMany({ student: userId, scheduledDate: { $gte: today } }).session(session);
  } else {
    await Delivery.deleteMany({ student: userId, scheduledDate: { $gte: today } });
  }

  const Meal = require('../models/Meal');
  const approvedMealsQuery = Meal.find({ approvalStatus: 'approved' }).lean();
  const approvedMeals = session ? await approvedMealsQuery.session(session) : await approvedMealsQuery;
  if (!approvedMeals || approvedMeals.length === 0) {
    throw new Error("No approved meals available in the system.");
  }
  const defaultMeal = approvedMeals[0];
  const defaultVendor = defaultMeal.vendor;

  const breakfastMeal = breakfastMealId ? (session ? await Meal.findById(breakfastMealId).lean().session(session) : await Meal.findById(breakfastMealId).lean()) : null;
  const lunchMeal = lunchMealId ? (session ? await Meal.findById(lunchMealId).lean().session(session) : await Meal.findById(lunchMealId).lean()) : null;
  const supperMeal = supperMealId ? (session ? await Meal.findById(supperMealId).lean().session(session) : await Meal.findById(supperMealId).lean()) : null;

  const slots = [];
  if (breakfast || customSchedule) slots.push('Breakfast');
  if (lunch || customSchedule) slots.push('Lunch');
  if (supper || customSchedule) slots.push('Supper');

  const deliveriesToInsert = [];
  const locationName = studentProfile?.deliveryLocation ? studentProfile.deliveryLocation.hostelResidence || 'Campus' : 'Campus';
  const deliveryLocationId = studentProfile?.deliveryLocation?._id || null;

  if (customSchedule) {
    const uniqueMealIds = new Set();
    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      const dayConfig = Array.isArray(customSchedule) ? customSchedule[dayOffset] : customSchedule[String(dayOffset)] || customSchedule[dayOffset];
      if (dayConfig) {
        if (dayConfig.breakfast) uniqueMealIds.add(dayConfig.breakfast.toString());
        if (dayConfig.lunch) uniqueMealIds.add(dayConfig.lunch.toString());
        if (dayConfig.supper) uniqueMealIds.add(dayConfig.supper.toString());
      }
    }

    const fetchedMealsQuery = Meal.find({ _id: { $in: Array.from(uniqueMealIds) } }).lean();
    const fetchedMeals = session ? await fetchedMealsQuery.session(session) : await fetchedMealsQuery;
    const mealMap = {};
    for (const m of fetchedMeals) {
      mealMap[m._id.toString()] = m;
    }

    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      const scheduledDate = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const dayConfig = Array.isArray(customSchedule) ? customSchedule[dayOffset] : customSchedule[String(dayOffset)] || customSchedule[dayOffset];

      for (const slot of slots) {
        let matchingMeal = null;
        if (dayConfig) {
          const customizedMealId = dayConfig[slot.toLowerCase()] || dayConfig[slot];
          if (customizedMealId) {
            matchingMeal = mealMap[customizedMealId.toString()];
          }
        }

        if (!matchingMeal) continue;

        deliveriesToInsert.push({
          student: userId,
          subscription: subscription._id,
          vendor: matchingMeal.vendor || defaultVendor,
          items: [{ name: matchingMeal.name, quantity: 1 }],
          status: 'pending',
          totalCost: Number(matchingMeal.price || 150),
          timeSlot: slot,
          scheduledDate: scheduledDate,
          location: locationName,
          deliveryLocation: deliveryLocationId
        });
      }
    }
  } else {
    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      const scheduledDate = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      for (const slot of slots) {
        let matchingMeal = null;
        if (slot === 'Breakfast') matchingMeal = breakfastMeal;
        else if (slot === 'Lunch') matchingMeal = lunchMeal;
        else if (slot === 'Supper') matchingMeal = supperMeal;

        if (!matchingMeal) {
          matchingMeal = approvedMeals.find(m => m.category === (slot === 'Breakfast' ? 'drink' : 'main')) || defaultMeal;
        }

        deliveriesToInsert.push({
          student: userId,
          subscription: subscription._id,
          vendor: matchingMeal.vendor || defaultVendor,
          items: [{ name: matchingMeal.name, quantity: 1 }],
          status: 'pending',
          totalCost: Number(matchingMeal.price || 150),
          timeSlot: slot,
          scheduledDate: scheduledDate,
          location: locationName,
          deliveryLocation: deliveryLocationId
        });
      }
    }
  }

  if (deliveriesToInsert.length > 0) {
    if (session) {
      await Delivery.create(deliveriesToInsert, { session });
    } else {
      await Delivery.create(deliveriesToInsert);
    }
  }

  return subscription;
};

module.exports = {
  checkAndAutoCompleteSubscriptions,
  createCustomPlanSubscription
};
