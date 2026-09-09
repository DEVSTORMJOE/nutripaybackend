const Cart = require("../models/Cart");
const Wallet = require("../models/Wallet");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Delivery = require("../models/Delivery");
const Meal = require("../models/Meal");
const crypto = require("crypto");
const { sendMail } = require("../utils/mailer");
const walletService = require("../services/walletService");
const escrowService = require("../services/escrowService");
const subscriptionService = require("../services/subscriptionService");
const SponsorRequest = require("../models/SponsorRequest");

async function getCart(req, res) {
  try {
    const userId = req.user.id;
    let cart = await Cart.findOne({ user: userId }).lean();

    if (!cart) {
      const created = await Cart.create({ user: userId, currency: "KES", templates: [], schedule: {} });
      cart = created.toObject();
    }

    return res.json({
      currency: cart.currency || "KES",
      templates: cart.templates || [],
      schedule: cart.schedule || {},
    });
  } catch (e) {
    return res.status(500).json({ message: "Failed to load cart" });
  }
}

async function replaceCart(req, res) {
  try {
    const userId = req.user.id;

    const currency = req.body.currency || "KES";
    const templates = Array.isArray(req.body.templates) ? req.body.templates : [];
    const schedule = req.body.schedule && typeof req.body.schedule === "object" ? req.body.schedule : {};

    const updated = await Cart.findOneAndUpdate(
      { user: userId },
      { currency, templates, schedule },
      { new: true, upsert: true }
    ).lean();

    return res.json({
      currency: updated.currency,
      templates: updated.templates || [],
      schedule: updated.schedule || {},
    });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save cart" });
  }
}

async function clearCart(req, res) {
  try {
    const userId = req.user.id;
    await Cart.findOneAndUpdate({ user: userId }, { templates: [], schedule: {} }, { upsert: true });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to clear cart" });
  }
}

async function checkoutCart(req, res) {
  try {
    const userId = req.user.id;
    const deliveryNote = req.body?.deliveryNote || "";
    const cart = await Cart.findOne({ user: userId }).lean();
    if (!cart) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const monthlyTemplate = cart.templates && cart.templates.find(t => t.isMonthlyPlan || t.billingCycle === "monthly" || t.billingCycle === "weekly");

    if (monthlyTemplate) {
      const isWeeklyPlan = monthlyTemplate.billingCycle === "weekly" || monthlyTemplate.durationDays === 7;
      const durationDays = isWeeklyPlan ? 7 : 28;
      const billingCycle = isWeeklyPlan ? 'weekly' : 'monthly';

      const SystemSettings = require('../models/SystemSettings');
      if (isWeeklyPlan) {
        const weeklyEnabled = await SystemSettings.getSetting('weekly_subscriptions_enabled', true);
        if (!weeklyEnabled) {
          return res.status(400).json({ message: "Weekly subscriptions are currently disabled by administration." });
        }
      }

      // Enforce single active subscription constraint
      const SubscriptionModel = require('../models/Subscription');
      const Student = require('../models/Student');

      // Enforce single active subscription constraint atomically to mitigate concurrent checkout races (Double Checkout)
      // Auto-complete active subscription if all deliveries are already fulfilled
      const existingActiveSubscription = await subscriptionService.checkAndAutoCompleteSubscriptions(userId);
      if (existingActiveSubscription) {
        return res.status(400).json({ message: "You already have an active subscription in progress. You cannot check out another plan until your current plan is completed or opted out." });
      }

      let studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
      if (!studentProfile) {
        return res.status(404).json({ message: "Student profile not found." });
      }

      // Enforce profile completion (phone and hostel/location) before subscription checkout
      const User = require('../models/User');
      const studentUser = await User.findById(userId);
      const hasPhone = Boolean(studentUser && studentUser.phone && studentUser.phone.trim().length > 0);
      const hasHostelOrLocation = Boolean(
        (studentProfile.hostel && studentProfile.hostel.trim() !== '' && studentProfile.hostel.trim() !== 'Campus') ||
        studentProfile.deliveryLocation
      );

      if (!hasPhone || !hasHostelOrLocation) {
        return res.status(403).json({
          message: "Please complete your profile details (select hostel location and phone number) before checking out.",
          requiresProfileCompletion: true
        });
      }

      studentProfile.subscriptionActive = true;
      await studentProfile.save();

      const subtotalKes = Number(monthlyTemplate.main.price || 0);
      if (subtotalKes <= 0) {
        studentProfile.subscriptionActive = false;
        await studentProfile.save();
        return res.status(400).json({ message: "Subscription plan total cost must be greater than 0" });
      }

      // Reset any stale leftover locked funds from past un-refunded tests so lockedBalanceKES precisely matches the new subscription
      const Wallet = require('../models/Wallet');
      const studentWallet = await Wallet.findOne({ user: userId });
      if (studentWallet) {
        studentWallet.lockedBalanceKES = mongoose.Types.Decimal128.fromString("0.00");
        await studentWallet.save();
      }

      // 1. Lock subscription funds using the Escrow Service (Stellar token locking is mirrored inside)
      let lockResult;
      try {
        lockResult = await escrowService.lockSubscriptionFunds(userId, subtotalKes, null);
      } catch (lockErr) {
        studentProfile.subscriptionActive = false;
        await studentProfile.save();
        return res.status(500).json({ message: "Escrow funds locking failed: " + lockErr.message });
      }

      // Create an active Subscription record
      const Subscription = require('../models/Subscription');
      
      let startDate = new Date();
      if (monthlyTemplate.startDate) {
        const parts = String(monthlyTemplate.startDate).split("-");
        if (parts.length === 3) {
          const yyyy = parseInt(parts[0], 10);
          const mm = parseInt(parts[1], 10) - 1;
          const dd = parseInt(parts[2], 10);
          startDate = new Date(yyyy, mm, dd, 6, 0, 0, 0);
        } else {
          startDate = new Date(monthlyTemplate.startDate);
          startDate.setHours(6, 0, 0, 0);
        }
      } else {
        // Fallback: tomorrow
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(6, 0, 0, 0);
      }

      let actualDurationDays = durationDays;
      if (monthlyTemplate.customSchedule) {
        const scheduleKeys = Object.keys(monthlyTemplate.customSchedule);
        if (scheduleKeys.length > 0) {
          actualDurationDays = Math.max(1, scheduleKeys.length);
        }
      } else if (monthlyTemplate.durationDays) {
        actualDurationDays = Math.max(1, Number(monthlyTemplate.durationDays));
      }

      // endDate is actualDurationDays from startDate (inclusive)
      const endDate = new Date(startDate.getTime() + Math.max(0, actualDurationDays - 1) * 24 * 60 * 60 * 1000);

      const subscription = await Subscription.create({
        student: userId,
        planId: monthlyTemplate.planId || 'essential',
        status: 'active',
        startDate: startDate,
        endDate: endDate,
        totalPaidKES: subtotalKes,
        billingCycle: billingCycle,
        durationDays: actualDurationDays
      });

      // Clear out old unfulfilled or overlapping subscription deliveries for this student to prevent stale test data leaks
      await Delivery.deleteMany({
        student: userId,
        isCustom: { $ne: true },
        status: { $in: ['pending', 'assigned'] }
      });

      // 3. Schedule the deliveries based on WeeklyPlan or customSchedule
      const Meal = require('../models/Meal');
      const approvedMeals = await Meal.find({ approvalStatus: 'approved' }).lean();
      if (approvedMeals.length === 0) {
        return res.status(400).json({ message: "No approved meals available in the system yet." });
      }
      const defaultMeal = approvedMeals[0];
      const defaultVendor = defaultMeal.vendor;

      const drinkMeal = approvedMeals.find(m => m.category === 'drink') || defaultMeal;
      const mainMeal = approvedMeals.find(m => m.category === 'main') || defaultMeal;

      const slots = [];
      if (monthlyTemplate.planId === 'essential') {
        slots.push('Lunch', 'Supper');
      } else {
        slots.push('Breakfast', 'Lunch', 'Supper');
      }

      const deliveriesToInsert = [];
      const deliveryLocationId = studentProfile?.deliveryLocation?._id || null;
      const hostelResidence = studentProfile?.deliveryLocation?.hostelResidence || 'Campus';

      if (monthlyTemplate.customSchedule) {
        const customSchedule = monthlyTemplate.customSchedule;
        const uniqueMealIds = new Set();

        for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
          const dayConfig = Array.isArray(customSchedule) ? customSchedule[dayOffset] : customSchedule[String(dayOffset)] || customSchedule[dayOffset];
          if (dayConfig) {
            if (dayConfig.breakfast) uniqueMealIds.add(dayConfig.breakfast.toString());
            if (dayConfig.lunch) uniqueMealIds.add(dayConfig.lunch.toString());
            if (dayConfig.supper) uniqueMealIds.add(dayConfig.supper.toString());
          }
        }

        const fetchedMeals = await Meal.find({ _id: { $in: Array.from(uniqueMealIds) } }).lean();
        const mealMap = {};
        for (const m of fetchedMeals) {
          mealMap[m._id.toString()] = m;
        }

        for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
          const scheduledDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const dayConfig = Array.isArray(customSchedule) ? customSchedule[dayOffset] : customSchedule[String(dayOffset)] || customSchedule[dayOffset];

          for (const slot of slots) {
            let matchedMeal = null;
            if (dayConfig) {
              const customizedMealId = dayConfig[slot.toLowerCase()] || dayConfig[slot];
              if (customizedMealId) {
                matchedMeal = mealMap[customizedMealId.toString()];
              }
            }

            if (!matchedMeal) {
              matchedMeal = slot === 'Breakfast' ? drinkMeal : mainMeal;
            }

            deliveriesToInsert.push({
              student: userId,
              subscription: subscription._id,
              vendor: matchedMeal.vendor || defaultVendor,
              items: [{ name: matchedMeal.name, quantity: 1 }],
              status: 'pending',
              totalCost: Number(matchedMeal.price || 150),
              timeSlot: slot,
              scheduledDate: scheduledDate,
              location: hostelResidence,
              deliveryLocation: deliveryLocationId,
              deliveryNote: deliveryNote
            });
          }
        }
      } else {
        const WeeklyPlan = require('../models/WeeklyPlan');
        const plans = await WeeklyPlan.find({ planId: monthlyTemplate.planId })
          .populate('breakfast')
          .populate('lunch')
          .populate('supper')
          .lean();

        for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
          const scheduledDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const dayName = weekdays[scheduledDate.getDay()];
          const week = isWeeklyPlan ? 1 : Math.floor(dayOffset / 7) + 1;
          const mappedWeek = week > 2 ? ((week - 1) % 2) + 1 : week;

          const matchedPlan = plans.find(p => (p.week === week || p.week === mappedWeek) && p.day === dayName);

          for (const slot of slots) {
            let matchedMeal = null;
            if (matchedPlan) {
              if (slot === 'Breakfast') matchedMeal = matchedPlan.breakfast;
              else if (slot === 'Lunch') matchedMeal = matchedPlan.lunch;
              else if (slot === 'Supper') matchedMeal = matchedPlan.supper;
            }

            if (!matchedMeal) {
              matchedMeal = slot === 'Breakfast' ? drinkMeal : mainMeal;
            }

            const items = [{ name: matchedMeal.name, quantity: 1 }];
            if (monthlyTemplate.planId === 'ultimate' && slot === 'Supper') {
              items.push({ name: 'Daily Seasonal Fruit', quantity: 1 });
            }

            deliveriesToInsert.push({
              student: userId,
              subscription: subscription._id,
              vendor: matchedMeal.vendor || defaultVendor,
              items: items,
              status: 'pending',
              totalCost: Number(matchedMeal.price || 150),
              timeSlot: slot,
              scheduledDate: scheduledDate,
              location: hostelResidence,
              deliveryLocation: deliveryLocationId,
              deliveryNote: deliveryNote
            });
          }
        }
      }

      if (deliveriesToInsert.length > 0) {
        await Delivery.create(deliveriesToInsert);

        const Notification = require("../models/Notification");
        const vendorTotals = {};
        deliveriesToInsert.forEach(d => {
          if (!vendorTotals[d.vendor]) vendorTotals[d.vendor] = 0;
          vendorTotals[d.vendor] += d.totalCost;
        });

        const Vendor = require("../models/Vendor");
        const targetVendors = await Vendor.find({ _id: { $in: Object.keys(vendorTotals) } });
        
        for (const vDoc of targetVendors) {
          await Notification.create({
            user: vDoc.user,
            type: 'order',
            title: 'New Student Subscription Order',
            message: `A student subscribed to ${monthlyTemplate.label} and scheduled deliveries totaling ${vendorTotals[vDoc._id.toString()]} KES.`
          });
        }
      }

      // 4. Clear Cart
      const CartModel = require('../models/Cart');
      await CartModel.findOneAndUpdate({ user: userId }, { templates: [], schedule: {} });

      // Dispatch SMS to Student and Admin
      try {
        const { notifyOrderPlacement } = require('../utils/orderSmsNotifier');
        notifyOrderPlacement({
          orderType: 'Monthly Subscription Plan',
          orderId: subscription._id.toString().slice(-8).toUpperCase(),
          studentName: req.user.name || 'Student',
          studentPhone: req.user.phone || '',
          itemsSummary: `${deliveriesToInsert.length} Scheduled Deliveries`,
          amountKES: subtotalKes
        });
      } catch (smsErr) {
        console.warn("[cartController] Monthly checkout SMS error (ignored):", smsErr.message);
      }

      if (global.io) {
        global.io.emit("order:created", { subscription, count: deliveriesToInsert.length });
        global.io.emit("order:updated", { subscription });
      }

      return res.json({
        ok: true,
        newBalance: lockResult.studentWallet.availableBalanceKES,
        subscription
      });
    }

    if (!cart.schedule || Object.keys(cart.schedule).length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // 1. Calculate Subtotal (KES) for daily items
    let subtotalKes = 0;
    for (const date of Object.keys(cart.schedule)) {
      const day = cart.schedule[date];
      if (!day) continue;
      const qty = Math.max(1, Number(day.qty || 1));
      const main = Number(day?.main?.price || 0);
      const drink = Number(day?.drink?.price || 0);
      const fruit = Number(day?.fruit?.price || 0);
      subtotalKes += (main + drink + fruit) * qty;
    }

    if (subtotalKes <= 0) {
      return res.status(400).json({ message: "Cart total must be greater than 0" });
    }

    // 2. Lock subscription funds using the Escrow Service (both Mongo updates and Stellar Treasury -> Escrow)
    const lockResult = await escrowService.lockSubscriptionFunds(userId, subtotalKes, null);

    // 3. Create Deliveries for the scheduled days based on the actual Vendor of the meal
    const mealIdsToFetch = new Set();
    for (const date of Object.keys(cart.schedule)) {
      const day = cart.schedule[date];
      if (!day) continue;
      if (day.main && day.main.mealId) mealIdsToFetch.add(day.main.mealId.toString());
      if (day.drink && day.drink.mealId) mealIdsToFetch.add(day.drink.mealId.toString());
      if (day.fruit && day.fruit.mealId) mealIdsToFetch.add(day.fruit.mealId.toString());
    }

    const fetchedMeals = await Meal.find({ _id: { $in: Array.from(mealIdsToFetch) } }).lean();
    const mealVendorMap = {};
    for (const m of fetchedMeals) {
      if (m.vendor) {
        mealVendorMap[m._id.toString()] = m.vendor.toString();
      }
    }

    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
    const deliveryLocationId = studentProfile?.deliveryLocation?._id || null;
    const hostelResidence = studentProfile?.deliveryLocation?.hostelResidence || 'Campus';

    const deliveriesToInsert = [];
    
    for (const date of Object.keys(cart.schedule)) {
      const day = cart.schedule[date];
      if (!day) continue;
      
      const qty = Math.max(1, Number(day.qty || 1));
      
      // We need to group items by vendor for this specific day
      const vendorGroups = {};
      
      const processItem = (item) => {
        if (!item || !item.mealId) return;
        const vId = mealVendorMap[item.mealId.toString()];
        if (!vId) return;
        
        if (!vendorGroups[vId]) vendorGroups[vId] = { items: [], totalCost: 0 };
        
        vendorGroups[vId].items.push({ name: item.name, quantity: qty });
        vendorGroups[vId].totalCost += (Number(item.price) || 0) * qty;
      };

      processItem(day.main);
      processItem(day.drink);
      processItem(day.fruit);

      for (const [vId, group] of Object.entries(vendorGroups)) {
        deliveriesToInsert.push({
          student: userId,
          vendor: vId,
          items: group.items,
          status: 'pending',
          totalCost: group.totalCost,
          timeSlot: day.timeSlot || 'Lunch',
          scheduledDate: new Date(date),
          location: hostelResidence,
          deliveryLocation: deliveryLocationId,
          deliveryNote: deliveryNote
        });
      }
    }
    
    if (deliveriesToInsert.length > 0) {
      await Delivery.create(deliveriesToInsert);

      const Notification = require("../models/Notification");
      const vendorTotals = {};
      deliveriesToInsert.forEach(d => {
        if(!vendorTotals[d.vendor]) vendorTotals[d.vendor] = 0;
        vendorTotals[d.vendor] += d.totalCost;
      });

      // Need to find the users for these vendors
      const Vendor = require("../models/Vendor");
      const targetVendors = await Vendor.find({ _id: { $in: Object.keys(vendorTotals) } });
      
      for (const vDoc of targetVendors) {
        await Notification.create({
          user: vDoc.user,
          type: 'order',
          title: 'New Student Order',
          message: `A student scheduled deliveries totaling ${vendorTotals[vDoc._id.toString()]} KES.`
        });
      }
    }

    // 4. Dispatch SMS notification to Student & Admin
    try {
      const { notifyOrderPlacement } = require('../utils/orderSmsNotifier');
      notifyOrderPlacement({
        orderType: 'Scheduled Meal Order',
        orderId: `CART_${userId.toString().slice(-6).toUpperCase()}`,
        studentName: req.user.name || 'Student',
        studentPhone: req.user.phone || '',
        itemsSummary: `${deliveriesToInsert.length} Scheduled Deliveries`,
        amountKES: subtotalKes
      });
    } catch (smsErr) {
      console.warn("[cartController] Daily checkout SMS error (ignored):", smsErr.message);
    }

    if (global.io) {
      global.io.emit("order:created", { deliveriesCount: deliveriesToInsert.length, userId });
      global.io.emit("order:updated", { deliveriesCount: deliveriesToInsert.length, userId });
    }

    // 5. Clear Cart
    await Cart.findOneAndUpdate({ user: userId }, { schedule: {} });

    return res.json({
      ok: true,
      newBalance: lockResult.studentWallet.availableBalanceKES
    });
  } catch (e) {
    console.error("Checkout failed:", e);
    return res.status(500).json({ message: "Checkout Payment failed: " + e.message });
  }
}

async function addSponsorCheckout(req, res) {
  try {
    const userId = req.user.id;
    const sponsorName = req.body.sponsorName;
    const sponsorPhone = req.body.sponsorPhone;
    const sponsorEmail = req.body.sponsorEmail?.trim().toLowerCase();

    if (!sponsorName || !sponsorEmail) {
      return res.status(400).json({ message: "Sponsor name and email are required." });
    }

    const cart = await Cart.findOne({ user: userId }).lean();
    // ✅ Cart may use either schedule (custom/daily) or templates (monthly plan)
    const hasSchedule = cart?.schedule && Object.keys(cart.schedule).length > 0;
    const hasTemplates = cart?.templates && cart.templates.length > 0;
    if (!cart || (!hasSchedule && !hasTemplates)) {
      return res.status(400).json({ message: "Cart is empty. Please add a plan to your cart before requesting a sponsor." });
    }

    let sponsor = await User.findOne({ email: sponsorEmail });
    let isNewSponsor = false;
    let generatedPassword = "";

    if (!sponsor) {
      isNewSponsor = true;
      generatedPassword = crypto.randomBytes(4).toString("hex");

      sponsor = await User.create({
        name: sponsorName,
        email: sponsorEmail,
        password: generatedPassword, 
        role: "sponsor",
      });
    }

    // Link sponsor to student and vice versa
    await User.findByIdAndUpdate(sponsor._id, {
      $addToSet: { linkedAccounts: userId }
    });
    await User.findByIdAndUpdate(userId, {
      $addToSet: { linkedAccounts: sponsor._id }
    });

    // Subtotal calculation for email — handles both monthly templates and custom schedule
    let subtotalKes = 0;

    // Monthly/preset plan via templates
    if (cart.templates && cart.templates.length > 0) {
      for (const tmpl of cart.templates) {
        const price = Number(tmpl.main?.price || tmpl.price || tmpl.totalCost || 0);
        subtotalKes += price;
      }
    }

    // Custom day-by-day schedule
    if (cart.schedule && Object.keys(cart.schedule).length > 0) {
      for (const date of Object.keys(cart.schedule)) {
        const day = cart.schedule[date];
        if (!day) continue;
        const qty = Math.max(1, Number(day.qty || 1));
        const main = Number(day?.main?.price || 0);
        const drink = Number(day?.drink?.price || 0);
        const fruit = Number(day?.fruit?.price || 0);
        subtotalKes += (main + drink + fruit) * qty;
      }
    }

    // Generate secure sponsorship token
    const token = crypto.randomBytes(32).toString("hex");
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const paymentLink = `${frontendUrl}/sponsor-pay?token=${token}`;

    let emailHtml = `
      <div style="font-family: 'Inter', system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); padding: 30px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 28px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">Nutri<span style="color: #ffd045;">Pay</span></h1>
          <p style="color: rgba(255,255,255,0.85); font-size: 12px; margin: 5px 0 0 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px;">Student Meal Request</p>
        </div>
        
        <div style="padding: 40px 30px; line-height: 1.6; color: #334155;">
          <h2 style="font-size: 20px; font-weight: 800; margin-top: 0; color: #0f172a;">Hello ${sponsorName},</h2>
          <p style="font-size: 15px; color: #475569;">
            A student has requested you to sponsor their upcoming meals on NutriPay.
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; margin: 25px 0; border-radius: 6px; text-align: center;">
            <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: bold; letter-spacing: 1px;">Sponsorship Subtotal</span>
            <div style="font-size: 32px; font-weight: 900; color: #f81d1d; margin: 5px 0;">KES ${subtotalKes.toLocaleString()}</div>
            <span style="font-size: 11px; color: #94a3b8; font-weight: bold; text-transform: uppercase;">28-Day Secure Escrow Lock</span>
          </div>
          
          <p style="font-size: 14px; color: #475569; text-align: center; margin-bottom: 25px;">
            Please click the button below to verify and complete this sponsorship payment securely:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${paymentLink}" style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); color: #ffffff; padding: 14px 35px; text-decoration: none; font-weight: bold; font-size: 14px; letter-spacing: 1px; border-radius: 6px; display: inline-block; box-shadow: 0 4px 10px rgba(248,29,29,0.25);">APPROVE & SPONSOR NOW</a>
          </div>
    `;

    if (isNewSponsor) {
        emailHtml += `
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; margin-top: 30px; border-radius: 6px;">
            <h4 style="margin-top: 0; color: #0f172a; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Your Sponsor Account Credentials</h4>
            <p style="margin: 5px 0; font-size: 13px; color: #475569;"><strong>Username / Email:</strong> ${sponsorEmail}</p>
            <p style="margin: 5px 0; font-size: 13px; color: #475569;"><strong>One-Time Password:</strong> <code style="background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #0f172a;">${generatedPassword}</code></p>
            <p style="margin: 15px 0 0 0; font-size: 11px; color: #64748b; font-style: italic;">
              You can log in via OTP at any time to monitor transactions, review active meal deliveries, and manage your student's budget.
            </p>
          </div>
        `;
    } else {
        emailHtml += `
          <p style="font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 30px;">
            You can log in to your existing Sponsor account using OTP at any time to monitor your student's active meal plan.
          </p>
        `;
    }

    emailHtml += `
        </div>
        <div style="background-color: #f8fafc; padding: 25px 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">
          <p style="margin: 0; font-weight: bold;">NutriPay - Decentralized Student Dining Wallet Platform</p>
          <p style="margin: 5px 0 0 0;">This email was sent securely via Stellar Custodial Treasury Notification Service.</p>
          <p style="margin: 15px 0 0 0; color: #94a3b8;">&copy; ${new Date().getFullYear()} NutriPay. All rights reserved.</p>
        </div>
      </div>
    `;

    try {
      await sendMail({
        to: sponsorEmail,
        subject: "NutriPay - Secure Student Meal Request",
        html: emailHtml,
      });
      console.log(`[EMAIL SENT] To: ${sponsorEmail}`);
    } catch (mailErr) {
      console.error("Failed to send mail, proceeding anyway:", mailErr);
    }

    // Emitting the awaiting_sponsor deliveries for the Sponsor
    const deliveriesToInsert = [];
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
    const deliveryLocationId = studentProfile?.deliveryLocation?._id || null;
    const hostelResidence = studentProfile?.deliveryLocation?.hostelResidence || 'Campus';

    const monthlyTemplate = cart.templates && cart.templates.find(t => t.isMonthlyPlan || t.billingCycle === "monthly" || t.billingCycle === "weekly");
    
    // Determine planId, startDate, endDate, and durationDays
    let planId = 'essential';
    let startDate = new Date();
    let isWeeklyPlan = false;
    let durationDays = 28;

    if (monthlyTemplate) {
      isWeeklyPlan = monthlyTemplate.billingCycle === "weekly" || monthlyTemplate.durationDays === 7;
      durationDays = isWeeklyPlan ? 7 : 28;
      planId = monthlyTemplate.planId || 'essential';

      if (monthlyTemplate.startDate) {
        const parts = String(monthlyTemplate.startDate).split("-");
        if (parts.length === 3) {
          const yyyy = parseInt(parts[0], 10);
          const mm = parseInt(parts[1], 10) - 1;
          const dd = parseInt(parts[2], 10);
          startDate = new Date(yyyy, mm, dd, 6, 0, 0, 0);
        } else {
          startDate = new Date(monthlyTemplate.startDate);
          startDate.setHours(6, 0, 0, 0);
        }
      } else {
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(6, 0, 0, 0);
      }
    }
    const endDate = monthlyTemplate ? new Date(startDate.getTime() + (durationDays - 1) * 24 * 60 * 60 * 1000) : null;

    if (monthlyTemplate) {
      const approvedMeals = await Meal.find({ approvalStatus: 'approved' }).lean();
      if (approvedMeals.length === 0) {
        return res.status(400).json({ message: "No approved meals available in the system yet." });
      }
      const defaultMeal = approvedMeals[0];
      const defaultVendor = defaultMeal.vendor;

      const drinkMeal = approvedMeals.find(m => m.category === 'drink') || defaultMeal;
      const mainMeal = approvedMeals.find(m => m.category === 'main') || defaultMeal;

      const slots = [];
      if (monthlyTemplate.planId === 'essential') {
        slots.push('Lunch', 'Supper');
      } else {
        slots.push('Breakfast', 'Lunch', 'Supper');
      }

      if (monthlyTemplate.customSchedule) {
        const customSchedule = monthlyTemplate.customSchedule;
        const uniqueMealIds = new Set();

        for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
          const dayConfig = Array.isArray(customSchedule) ? customSchedule[dayOffset] : customSchedule[String(dayOffset)] || customSchedule[dayOffset];
          if (dayConfig) {
            if (dayConfig.breakfast) uniqueMealIds.add(dayConfig.breakfast.toString());
            if (dayConfig.lunch) uniqueMealIds.add(dayConfig.lunch.toString());
            if (dayConfig.supper) uniqueMealIds.add(dayConfig.supper.toString());
          }
        }

        const fetchedMeals = await Meal.find({ _id: { $in: Array.from(uniqueMealIds) } }).lean();
        const mealMap = {};
        for (const m of fetchedMeals) {
          mealMap[m._id.toString()] = m;
        }

        for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
          const scheduledDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const dayConfig = Array.isArray(customSchedule) ? customSchedule[dayOffset] : customSchedule[String(dayOffset)] || customSchedule[dayOffset];

          for (const slot of slots) {
            let matchedMeal = null;
            if (dayConfig) {
              const customizedMealId = dayConfig[slot.toLowerCase()] || dayConfig[slot];
              if (customizedMealId) {
                matchedMeal = mealMap[customizedMealId.toString()];
              }
            }

            if (!matchedMeal) {
              matchedMeal = slot === 'Breakfast' ? drinkMeal : mainMeal;
            }

            deliveriesToInsert.push({
              student: userId,
              vendor: matchedMeal.vendor || defaultVendor,
              sponsor: sponsor._id,
              items: [{ name: matchedMeal.name, quantity: 1 }],
              status: 'awaiting_sponsor',
              totalCost: Number(matchedMeal.price || 150),
              timeSlot: slot,
              scheduledDate: scheduledDate,
              location: hostelResidence,
              deliveryLocation: deliveryLocationId
            });
          }
        }
      } else {
        const WeeklyPlan = require('../models/WeeklyPlan');
        const plans = await WeeklyPlan.find({ planId: monthlyTemplate.planId })
          .populate('breakfast')
          .populate('lunch')
          .populate('supper')
          .lean();

        for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
          const scheduledDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const dayName = weekdays[scheduledDate.getDay()];
          const week = isWeeklyPlan ? 1 : Math.floor(dayOffset / 7) + 1;

          const matchedPlan = plans.find(p => p.week === week && p.day === dayName);

          for (const slot of slots) {
            let matchedMeal = null;
            if (matchedPlan) {
              if (slot === 'Breakfast') matchedMeal = matchedPlan.breakfast;
              else if (slot === 'Lunch') matchedMeal = matchedPlan.lunch;
              else if (slot === 'Supper') matchedMeal = matchedPlan.supper;
            }

            if (!matchedMeal) {
              matchedMeal = slot === 'Breakfast' ? drinkMeal : mainMeal;
            }

            const items = [{ name: matchedMeal.name, quantity: 1 }];
            if (monthlyTemplate.planId === 'ultimate' && slot === 'Supper') {
              items.push({ name: 'Daily Seasonal Fruit', quantity: 1 });
            }

            deliveriesToInsert.push({
              student: userId,
              vendor: matchedMeal.vendor || defaultVendor,
              sponsor: sponsor._id,
              items: items,
              status: 'awaiting_sponsor',
              totalCost: Number(matchedMeal.price || 150),
              timeSlot: slot,
              scheduledDate: scheduledDate,
              location: hostelResidence,
              deliveryLocation: deliveryLocationId
            });
          }
        }
      }
    } else if (cart.schedule && Object.keys(cart.schedule).length > 0) {
      const mealIdsToFetch = new Set();
      for (const date of Object.keys(cart.schedule)) {
        const day = cart.schedule[date];
        if (!day) continue;
        if (day.main && day.main.mealId) mealIdsToFetch.add(day.main.mealId.toString());
        if (day.drink && day.drink.mealId) mealIdsToFetch.add(day.drink.mealId.toString());
        if (day.fruit && day.fruit.mealId) mealIdsToFetch.add(day.fruit.mealId.toString());
      }

      const fetchedMeals = await Meal.find({ _id: { $in: Array.from(mealIdsToFetch) } }).lean();
      const mealVendorMap = {};
      for (const m of fetchedMeals) {
        if (m.vendor) mealVendorMap[m._id.toString()] = m.vendor.toString();
      }

      for (const date of Object.keys(cart.schedule)) {
        const day = cart.schedule[date];
        if (!day) continue;
        const qty = Math.max(1, Number(day.qty || 1));
        const vendorGroups = {};
        
        const processItem = (item) => {
          if (!item || !item.mealId) return;
          const vId = mealVendorMap[item.mealId.toString()];
          if (!vId) return;
          if (!vendorGroups[vId]) vendorGroups[vId] = { items: [], totalCost: 0 };
          vendorGroups[vId].items.push({ name: item.name, quantity: qty });
          vendorGroups[vId].totalCost += (Number(item.price) || 0) * qty;
        };

        processItem(day.main);
        processItem(day.drink);
        processItem(day.fruit);

        for (const [vId, group] of Object.entries(vendorGroups)) {
          deliveriesToInsert.push({
            student: userId,
            vendor: vId,
            sponsor: sponsor._id, 
            items: group.items,
            status: 'awaiting_sponsor',
            totalCost: group.totalCost,
            timeSlot: day.timeSlot || 'Lunch',
            scheduledDate: new Date(date),
            location: hostelResidence,
            deliveryLocation: deliveryLocationId
          });
        }
      }
    }
    
    let createdDeliveryIds = [];
    if (deliveriesToInsert.length > 0) {
      if (cart.schedule && Object.keys(cart.schedule).length > 0 && !monthlyTemplate) {
        const dates = Object.keys(cart.schedule).map(d => new Date(d)).sort((a, b) => a - b);
        if (dates.length > 0) {
          startDate = dates[0];
        }
      }
      await Delivery.deleteMany({
        student: userId,
        scheduledDate: { $gte: startDate }
      });
      const inserted = await Delivery.create(deliveriesToInsert);
      createdDeliveryIds = inserted.map(d => d._id);
    }

    if (cart.schedule && Object.keys(cart.schedule).length > 0 && !monthlyTemplate) {
      const dates = Object.keys(cart.schedule).map(d => new Date(d)).sort((a, b) => a - b);
      if (dates.length > 0) {
        startDate = dates[0];
        endDate = dates[dates.length - 1];
        planId = 'custom';
      }
    }

    // Save the SponsorRequest
    await SponsorRequest.create({
      token,
      sponsorEmail,
      sponsorName,
      student: userId,
      deliveryIds: createdDeliveryIds,
      amountKES: subtotalKes,
      status: 'pending',
      planId,
      startDate,
      endDate
    });

    await Cart.findOneAndUpdate({ user: userId }, { schedule: {} });

    return res.json({ 
      ok: true, 
      message: `Request sent to ${sponsorName}. They have been emailed instructions.` 
    });
  } catch (err) {
    console.error("Add Sponsor Checkout failed:", err);
    return res.status(500).json({ message: "Failed to process sponsor checkout." });
  }
}

async function customPlanCheckout(req, res) {
  const { daysCount, breakfast, lunch, supper, totalCost, breakfastMealId, lunchMealId, supperMealId, customSchedule, startDate } = req.body;
  try {
    const userId = req.user.id;

    // Enforce single active subscription constraint
    const existingActiveSubscription = await subscriptionService.checkAndAutoCompleteSubscriptions(userId);
    if (existingActiveSubscription) {
      return res.status(400).json({ message: "You already have an active subscription in progress. You cannot check out another plan until your current plan is completed or opted out." });
    }

    if (!daysCount || daysCount <= 0) {
      return res.status(400).json({ message: "Days count must be greater than 0" });
    }
    if (!breakfast && !lunch && !supper && !customSchedule) {
      return res.status(400).json({ message: "At least one meal slot must be selected" });
    }
    if (!totalCost || totalCost <= 0) {
      return res.status(400).json({ message: "Total cost must be greater than 0" });
    }

    const subscription = await subscriptionService.createCustomPlanSubscription({
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
      customSchedule
    });

    // Clear Cart
    const CartModel = require('../models/Cart');
    await CartModel.findOneAndUpdate({ user: userId }, { schedule: {} });

    res.json({
      success: true,
      message: "Custom Monthly Plan built and checkout completed successfully!",
      subscription
    });
  } catch (err) {
    console.error("Custom plan checkout failed:", err);
    res.status(500).json({ message: "Custom plan checkout failed: " + err.message });
  }
}

async function customPlanMpesaCheckout(req, res) {
  const { phone, daysCount, breakfast, lunch, supper, totalCost, breakfastMealId, lunchMealId, supperMealId, customSchedule, startDate } = req.body;
  try {
    const userId = req.user.id;

    // Enforce single active subscription constraint
    const existingActiveSubscription = await subscriptionService.checkAndAutoCompleteSubscriptions(userId);
    if (existingActiveSubscription) {
      return res.status(400).json({ message: "You already have an active subscription in progress. You cannot check out another plan until your current plan is completed or opted out." });
    }

    if (!phone) {
      return res.status(400).json({ message: "M-Pesa phone number is required" });
    }

    const { validateAndNormalizePhone } = require('../utils/phoneValidator');
    const validatedPhone = validateAndNormalizePhone(phone);
    if (!validatedPhone) {
      return res.status(400).json({ message: "Invalid M-Pesa phone number" });
    }

    if (!daysCount || daysCount <= 0) {
      return res.status(400).json({ message: "Days count must be greater than 0" });
    }
    if (!breakfast && !lunch && !supper && !customSchedule) {
      return res.status(400).json({ message: "At least one meal slot must be selected" });
    }
    if (!totalCost || totalCost <= 0) {
      return res.status(400).json({ message: "Total cost must be greater than 0" });
    }

    const externalReference = `custom_plan_sub_${userId}_${Date.now()}`;
    const payheroService = require('../services/payheroService');
    const stkResult = await payheroService.initiateSTKPush(
      validatedPhone,
      Number(totalCost),
      externalReference,
      `Custom Plan (${daysCount} Days)`
    );

    if (!stkResult || !stkResult.CheckoutRequestID) {
      return res.status(400).json({ message: "Failed to initiate M-Pesa STK push. Please try again." });
    }

    const CheckoutRequest = require('../models/CheckoutRequest');
    await CheckoutRequest.create({
      checkoutRequestId: stkResult.CheckoutRequestID,
      merchantRequestId: stkResult.MerchantRequestID || stkResult.CheckoutRequestID,
      amountKES: Number(totalCost),
      user: userId,
      status: 'pending',
      metadata: {
        type: 'custom_plan_sub',
        userId,
        daysCount,
        breakfast,
        lunch,
        supper,
        totalCost,
        breakfastMealId,
        lunchMealId,
        supperMealId,
        customSchedule,
        startDate
      }
    });

    res.json({
      success: true,
      checkoutRequestID: stkResult.CheckoutRequestID,
      message: "M-Pesa STK push initiated. Please enter your PIN on your phone to complete your subscription."
    });
  } catch (err) {
    console.error("Custom plan M-Pesa checkout failed:", err);
    res.status(500).json({ message: "Custom plan M-Pesa checkout failed: " + err.message });
  }
}

async function customPlanSponsorCheckout(req, res) {
  const { 
    daysCount, 
    breakfast, 
    lunch, 
    supper, 
    totalCost, 
    breakfastMealId, 
    lunchMealId, 
    supperMealId, 
    customSchedule,
    sponsorName,
    sponsorPhone,
    sponsorEmail
  } = req.body;

  try {
    const userId = req.user.id;

    // Enforce single active subscription constraint
    const existingActiveSubscription = await subscriptionService.checkAndAutoCompleteSubscriptions(userId);
    if (existingActiveSubscription) {
      return res.status(400).json({ message: "You already have an active subscription in progress. You cannot check out another plan until your current plan is completed or opted out." });
    }

    if (!sponsorName || !sponsorEmail) {
      return res.status(400).json({ message: "Sponsor name and email are required." });
    }

    if (!daysCount || daysCount <= 0) {
      return res.status(400).json({ message: "Days count must be greater than 0" });
    }
    if (!breakfast && !lunch && !supper && !customSchedule) {
      return res.status(400).json({ message: "At least one meal slot must be selected" });
    }
    if (!totalCost || totalCost <= 0) {
      return res.status(400).json({ message: "Total cost must be greater than 0" });
    }

    // Find or create the sponsor user
    const emailLower = sponsorEmail.trim().toLowerCase();
    let sponsor = await User.findOne({ email: emailLower });
    let isNewSponsor = false;
    let generatedPassword = "";

    if (!sponsor) {
      isNewSponsor = true;
      generatedPassword = crypto.randomBytes(4).toString("hex");

      sponsor = await User.create({
        name: sponsorName,
        email: emailLower,
        password: generatedPassword, 
        role: "sponsor",
        phone: sponsorPhone || ""
      });
    }

    // Link sponsor to student and vice versa
    await User.findByIdAndUpdate(sponsor._id, {
      $addToSet: { linkedAccounts: userId }
    });
    await User.findByIdAndUpdate(userId, {
      $addToSet: { linkedAccounts: sponsor._id }
    });

    // Generate secure sponsorship token
    const token = crypto.randomBytes(32).toString("hex");
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const paymentLink = `${frontendUrl}/sponsor-pay?token=${token}`;

    let emailHtml = `
      <div style="font-family: 'Inter', system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); padding: 30px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 28px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">Nutri<span style="color: #ffd045;">Pay</span></h1>
          <p style="color: rgba(255,255,255,0.85); font-size: 12px; margin: 5px 0 0 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px;">Student Meal Request</p>
        </div>
        
        <div style="padding: 40px 30px; line-height: 1.6; color: #334155;">
          <h2 style="font-size: 20px; font-weight: 800; margin-top: 0; color: #0f172a;">Hello ${sponsorName},</h2>
          <p style="font-size: 15px; color: #475569;">
            A student has requested you to sponsor their custom dining plan on NutriPay.
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; margin: 25px 0; border-radius: 6px; text-align: center;">
            <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: bold; letter-spacing: 1px;">Sponsorship Subtotal</span>
            <div style="font-size: 32px; font-weight: 900; color: #f81d1d; margin: 5px 0;">KES ${totalCost.toLocaleString()}</div>
            <span style="font-size: 11px; color: #94a3b8; font-weight: bold; text-transform: uppercase;">Custom Secure Escrow Lock</span>
          </div>
          
          <p style="font-size: 14px; color: #475569; text-align: center; margin-bottom: 25px;">
            Please click the button below to verify and complete this sponsorship payment securely:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${paymentLink}" style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); color: #ffffff; padding: 14px 35px; text-decoration: none; font-weight: bold; font-size: 14px; letter-spacing: 1px; border-radius: 6px; display: inline-block; box-shadow: 0 4px 10px rgba(248,29,29,0.25);">APPROVE & SPONSOR NOW</a>
          </div>
    `;

    if (isNewSponsor) {
        emailHtml += `
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; margin-top: 30px; border-radius: 6px;">
            <h4 style="margin-top: 0; color: #0f172a; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Your Sponsor Account Credentials</h4>
            <p style="margin: 5px 0; font-size: 13px; color: #475569;"><strong>Username / Email:</strong> ${sponsorEmail}</p>
            <p style="margin: 5px 0; font-size: 13px; color: #475569;"><strong>One-Time Password:</strong> <code style="background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #0f172a;">${generatedPassword}</code></p>
            <p style="margin: 15px 0 0 0; font-size: 11px; color: #64748b; font-style: italic;">
              You can log in via OTP at any time to monitor transactions, review active meal deliveries, and manage your student's budget.
            </p>
          </div>
        `;
    } else {
        emailHtml += `
          <p style="font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 30px;">
            You can log in to your existing Sponsor account using OTP at any time to monitor your student's active meal plan.
          </p>
        `;
    }

    emailHtml += `
        </div>
        <div style="background-color: #f8fafc; padding: 25px 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">
          <p style="margin: 0; font-weight: bold;">NutriPay - Decentralized Student Dining Wallet Platform</p>
          <p style="margin: 5px 0 0 0;">This email was sent securely via Stellar Custodial Treasury Notification Service.</p>
          <p style="margin: 15px 0 0 0; color: #94a3b8;">&copy; ${new Date().getFullYear()} NutriPay. All rights reserved.</p>
        </div>
      </div>
    `;

    try {
      await sendMail({
        to: sponsorEmail,
        subject: "NutriPay - Secure Student Custom Meal Request",
        html: emailHtml,
      });
      console.log(`[EMAIL SENT] To: ${sponsorEmail}`);
    } catch (mailErr) {
      console.error("Failed to send mail, proceeding anyway:", mailErr);
    }

    // Schedule deliveries with status 'awaiting_sponsor'
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
    const locationName = studentProfile?.deliveryLocation ? studentProfile.deliveryLocation.hostelResidence || 'Campus' : 'Campus';
    const deliveryLocationId = studentProfile?.deliveryLocation?._id || null;

    const Delivery = require('../models/Delivery');
    const Meal = require('../models/Meal');

    const today = req.body.startDate ? new Date(req.body.startDate) : new Date();

    // Clear out overlapping or future deliveries to overwrite cancelled/old ones
    await Delivery.deleteMany({
      student: userId,
      scheduledDate: { $gte: today }
    });
    
    // Find default approved meals
    const approvedMeals = await Meal.find({ approvalStatus: 'approved' }).lean();
    if (approvedMeals.length === 0) {
      return res.status(400).json({ message: "No approved meals available in the system yet." });
    }
    const defaultMeal = approvedMeals[0];
    const defaultVendor = defaultMeal.vendor;

    const breakfastMeal = breakfastMealId ? await Meal.findById(breakfastMealId).lean() : null;
    const lunchMeal = lunchMealId ? await Meal.findById(lunchMealId).lean() : null;
    const supperMeal = supperMealId ? await Meal.findById(supperMealId).lean() : null;

    const slots = [];
    if (breakfast || customSchedule) slots.push('Breakfast');
    if (lunch || customSchedule) slots.push('Lunch');
    if (supper || customSchedule) slots.push('Supper');

    const deliveriesToInsert = [];

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

      const fetchedMeals = await Meal.find({ _id: { $in: Array.from(uniqueMealIds) } }).lean();
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

          if (!matchingMeal) {
            // In customSchedule, if no meal was selected for this slot, do not schedule a delivery.
            continue;
          }

          deliveriesToInsert.push({
            student: userId,
            vendor: matchingMeal.vendor || defaultVendor,
            sponsor: sponsor._id,
            items: [{ name: matchingMeal.name, quantity: 1 }],
            status: 'awaiting_sponsor',
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
            vendor: matchingMeal.vendor || defaultVendor,
            sponsor: sponsor._id,
            items: [{ name: matchingMeal.name, quantity: 1 }],
            status: 'awaiting_sponsor',
            totalCost: Number(matchingMeal.price || 150),
            timeSlot: slot,
            scheduledDate: scheduledDate,
            location: locationName,
            deliveryLocation: deliveryLocationId
          });
        }
      }
    }

    let createdDeliveryIds = [];
    if (deliveriesToInsert.length > 0) {
      const inserted = await Delivery.create(deliveriesToInsert);
      createdDeliveryIds = inserted.map(d => d._id);
    }

    const endDate = new Date(today.getTime() + daysCount * 24 * 60 * 60 * 1000);

    // Save the SponsorRequest
    await SponsorRequest.create({
      token,
      sponsorEmail,
      sponsorName,
      student: userId,
      deliveryIds: createdDeliveryIds,
      amountKES: totalCost,
      status: 'pending',
      planId: 'custom',
      startDate: today,
      endDate: endDate
    });

    // Clear local custom schedule in student's cart
    const CartModel = require('../models/Cart');
    await CartModel.findOneAndUpdate({ user: userId }, { schedule: {} });

    return res.json({ 
      ok: true, 
      message: `Request sent to ${sponsorName}. They have been emailed instructions.` 
    });
  } catch (err) {
    console.error("Custom plan sponsor checkout failed:", err);
    res.status(500).json({ message: "Custom plan sponsor checkout failed: " + err.message });
  }
}

async function dailyTemplateCheckout(req, res) {
  const { startDate, endDate, items, timeSlot, totalCost } = req.body;
  try {
    const userId = req.user.id;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Start date and end date are required." });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Selected template items are required." });
    }
    if (!totalCost || totalCost <= 0) {
      return res.status(400).json({ message: "Total cost must be greater than 0" });
    }

    // 1. Lock subscription funds using the Escrow Service
    const lockResult = await escrowService.lockSubscriptionFunds(userId, totalCost, null);

    // 2. Resolve Student delivery profile
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
    const deliveryLocationId = studentProfile?.deliveryLocation?._id || null;
    const hostelResidence = studentProfile?.deliveryLocation?.hostelResidence || 'Campus';

    const Meal = require('../models/Meal');
    const Delivery = require('../models/Delivery');

    // Group template items by vendor
    const vendorGroups = {};
    for (const item of items) {
      const mealDoc = await Meal.findById(item.mealId || item._id).lean();
      if (!mealDoc || !mealDoc.vendor) continue;
      const vId = mealDoc.vendor.toString();
      if (!vendorGroups[vId]) {
        vendorGroups[vId] = { items: [], dailyCost: 0 };
      }
      vendorGroups[vId].items.push({
        name: item.name,
        quantity: item.qty || item.quantity || 1
      });
      vendorGroups[vId].dailyCost += Number(item.price) * (item.qty || item.quantity || 1);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const daysCount = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const deliveriesToInsert = [];
    
    // Iterate day by day from start to end (inclusive)
    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      const scheduledDate = new Date(start.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      
      for (const [vId, group] of Object.entries(vendorGroups)) {
        deliveriesToInsert.push({
          student: userId,
          vendor: vId,
          items: group.items,
          status: 'pending',
          totalCost: group.dailyCost,
          timeSlot: timeSlot || 'Lunch',
          scheduledDate: scheduledDate,
          location: hostelResidence,
          deliveryLocation: deliveryLocationId
        });
      }
    }

    if (deliveriesToInsert.length > 0) {
      await Delivery.create(deliveriesToInsert);

      const Notification = require("../models/Notification");
      const vendorTotals = {};
      deliveriesToInsert.forEach(d => {
        if (!vendorTotals[d.vendor]) vendorTotals[d.vendor] = 0;
        vendorTotals[d.vendor] += d.totalCost;
      });

      const Vendor = require("../models/Vendor");
      const targetVendors = await Vendor.find({ _id: { $in: Object.keys(vendorTotals) } });
      
      for (const vDoc of targetVendors) {
        await Notification.create({
          user: vDoc.user,
          type: 'order',
          title: 'New Daily Template Order',
          message: `A student scheduled ${daysCount} days of daily template deliveries totaling ${vendorTotals[vDoc._id.toString()]} KES.`
        });
      }
    }

    // 4. Clear Cart
    const CartModel = require('../models/Cart');
    await CartModel.findOneAndUpdate({ user: userId }, { schedule: {} });

    res.json({
      success: true,
      message: "Daily Template Plan checked out and deliveries scheduled successfully!",
      newBalance: lockResult.studentWallet.availableBalanceKES
    });
  } catch (error) {
    console.error("Daily template checkout failed:", error);
    res.status(500).json({ message: "Daily template checkout failed: " + error.message });
  }
}

module.exports = { getCart, replaceCart, clearCart, checkoutCart, addSponsorCheckout, customPlanCheckout, customPlanMpesaCheckout, customPlanSponsorCheckout, dailyTemplateCheckout };