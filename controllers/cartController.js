const Cart = require("../models/Cart");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Delivery = require("../models/Delivery");
const Meal = require("../models/Meal");
const crypto = require("crypto");
const { sendMail } = require("../utils/mailer");
const walletService = require("../services/walletService");
const escrowService = require("../services/escrowService");
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
    const cart = await Cart.findOne({ user: userId }).lean();
    if (!cart) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const monthlyTemplate = cart.templates && cart.templates.find(t => t.isMonthlyPlan || t.billingCycle === "monthly");

    if (monthlyTemplate) {
      // Enforce single active subscription constraint
      const SubscriptionModel = require('../models/Subscription');
      const existingActiveSubscription = await SubscriptionModel.findOne({ student: userId, status: 'active' });
      if (existingActiveSubscription) {
        return res.status(400).json({ message: "You already have an active subscription. You cannot check out another plan until you opt out of the current one." });
      }

      const subtotalKes = Number(monthlyTemplate.main.price || 0);
      if (subtotalKes <= 0) {
        return res.status(400).json({ message: "Subscription plan total cost must be greater than 0" });
      }

      // 1. Lock subscription funds using the Escrow Service (Stellar token locking is mirrored inside)
      const lockResult = await escrowService.lockSubscriptionFunds(userId, subtotalKes, null);

      // 2. Create the Subscriptions in MongoDB
      const Student = require('../models/Student');
      const studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
      
      if (studentProfile) {
        studentProfile.subscriptionActive = true;
        await studentProfile.save();
      }

      // Create an active Subscription record
      const Subscription = require('../models/Subscription');
      const today = new Date();
      const endDate = new Date(today.getTime() + 28 * 24 * 60 * 60 * 1000);
      const subscription = await Subscription.create({
        student: userId,
        planId: monthlyTemplate.planId || 'essential',
        status: 'active',
        startDate: today,
        endDate: endDate,
        totalPaidKES: subtotalKes
      });

      // 3. Schedule the monthly deliveries based on WeeklyPlan or customSchedule
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

        for (let dayOffset = 0; dayOffset < 28; dayOffset++) {
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

        for (let dayOffset = 0; dayOffset < 28; dayOffset++) {
          const scheduledDate = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
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
              items: [{ name: matchedMeal.name, quantity: 1 }],
              status: 'pending',
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

        for (let dayOffset = 0; dayOffset < 28; dayOffset++) {
          const scheduledDate = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const dayName = weekdays[scheduledDate.getDay()];
          const week = Math.floor(dayOffset / 7) + 1;

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
              items: items,
              status: 'pending',
              totalCost: Number(matchedMeal.price || 150),
              timeSlot: slot,
              scheduledDate: scheduledDate,
              location: hostelResidence,
              deliveryLocation: deliveryLocationId
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

      return res.json({
        ok: true,
        txHash: lockResult.transaction.stellarTxHash,
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
          location: 'Campus' // Default location for now
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

    // 4. Clear Cart
    await Cart.findOneAndUpdate({ user: userId }, { schedule: {} });

    return res.json({
      ok: true,
      txHash: lockResult.transaction.stellarTxHash,
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
    if (!cart || !cart.schedule || Object.keys(cart.schedule).length === 0) {
      return res.status(400).json({ message: "Cart is empty." });
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
      
      await walletService.creditWallet(
        sponsor._id,
        10000,
        'deposit',
        'wallet',
        'Initial Sponsor Signup Mock Funding'
      );
    }

    // Link sponsor to student and vice versa
    await User.findByIdAndUpdate(sponsor._id, {
      $addToSet: { linkedAccounts: userId }
    });
    await User.findByIdAndUpdate(userId, {
      $addToSet: { linkedAccounts: sponsor._id }
    });

    // Subtotal calculation for email
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

    // Generate secure sponsorship token
    const token = crypto.randomBytes(32).toString("hex");
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const paymentLink = `${frontendUrl}/sponsor-pay?token=${token}`;

    let emailHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #f81d1d; border-bottom: 2px solid #f81d1d; padding-bottom: 10px;">NutriPay - Student Meal Request</h2>
        <p>Hello ${sponsorName},</p>
        <p>A student has requested you to sponsor their meals totaling <strong>${subtotalKes} KES</strong>.</p>
        <p>Please click the button below to verify and complete this sponsorship payment securely:</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${paymentLink}" style="background-color: #f81d1d; color: white; padding: 12px 30px; text-decoration: none; font-weight: bold; display: inline-block;">APPROVE & SPONSOR NOW</a>
        </div>
    `;

    if (isNewSponsor) {
        emailHtml += `
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; margin-top: 20px;">
            <h4 style="margin-top: 0; color: #0b1220;">Your Sponsor Account Credentials</h4>
            <p style="margin: 5px 0; font-size: 13px;"><strong>Username / Email:</strong> ${sponsorEmail}</p>
            <p style="margin: 5px 0; font-size: 13px;"><strong>One-Time Password:</strong> ${generatedPassword}</p>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #64748b; font-style: italic;">
              You can log in via OTP at any time to monitor transactions and manage linked students.
            </p>
          </div>
        `;
    } else {
        emailHtml += `
          <p>You can also log in to your existing Sponsor account using OTP to manage your active student sponsorships.</p>
        `;
    }

    emailHtml += `</div>`;

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

    const deliveriesToInsert = [];
    
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
          location: 'Campus'
        });
      }
    }
    
    let createdDeliveryIds = [];
    if (deliveriesToInsert.length > 0) {
      const inserted = await Delivery.create(deliveriesToInsert);
      createdDeliveryIds = inserted.map(d => d._id);
    }

    // Save the SponsorRequest
    await SponsorRequest.create({
      token,
      sponsorEmail,
      sponsorName,
      student: userId,
      deliveryIds: createdDeliveryIds,
      amountKES: subtotalKes,
      status: 'pending'
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
  const { daysCount, breakfast, lunch, supper, totalCost, breakfastMealId, lunchMealId, supperMealId, customSchedule } = req.body;
  try {
    const userId = req.user.id;

    // Enforce single active subscription constraint
    const SubscriptionModel = require('../models/Subscription');
    const existingActiveSubscription = await SubscriptionModel.findOne({ student: userId, status: 'active' });
    if (existingActiveSubscription) {
      return res.status(400).json({ message: "You already have an active subscription. You cannot check out another plan until you opt out of the current one." });
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

    // 1. Lock subscription funds using the Escrow Service
    const lockResult = await escrowService.lockSubscriptionFunds(userId, totalCost, null);

    // 2. Create the Custom Subscriptions in MongoDB
    const Student = require('../models/Student');
    const studentProfile = await Student.findOne({ user: userId }).populate('deliveryLocation');
    
    // Save student subscription state
    if (studentProfile) {
      studentProfile.subscriptionActive = true;
      await studentProfile.save();
    }

    // Create an active Subscription record
    const Subscription = require('../models/Subscription');
    const today = req.body.startDate ? new Date(req.body.startDate) : new Date();
    const endDate = new Date(today.getTime() + daysCount * 24 * 60 * 60 * 1000);
    const subscription = await Subscription.create({
      student: userId,
      planId: 'custom',
      status: 'active',
      startDate: today,
      endDate: endDate,
      totalPaidKES: totalCost
    });

    // 3. Schedule the custom deliveries day by day
    const Delivery = require('../models/Delivery');
    const Meal = require('../models/Meal');
    
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
            if (slot === 'Breakfast') matchingMeal = breakfastMeal;
            else if (slot === 'Lunch') matchingMeal = lunchMeal;
            else if (slot === 'Supper') matchingMeal = supperMeal;
          }

          if (!matchingMeal) {
            matchingMeal = approvedMeals.find(m => m.category === (slot === 'Breakfast' ? 'drink' : 'main')) || defaultMeal;
          }

          deliveriesToInsert.push({
            student: userId,
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
      await Delivery.create(deliveriesToInsert);
    }

    // 4. Clear Cart
    const CartModel = require('../models/Cart');
    await CartModel.findOneAndUpdate({ user: userId }, { schedule: {} });

    res.json({
      success: true,
      message: "Custom Monthly Plan built and checkout completed successfully!",
      subscription
    });
  } catch (error) {
    console.error("Custom plan checkout failed:", error);
    res.status(500).json({ message: "Custom plan checkout failed: " + error.message });
  }
}

module.exports = { getCart, replaceCart, clearCart, checkoutCart, addSponsorCheckout, customPlanCheckout };