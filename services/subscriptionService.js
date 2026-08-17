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

module.exports = {
  checkAndAutoCompleteSubscriptions
};
