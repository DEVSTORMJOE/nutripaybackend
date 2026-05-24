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
    if (!cart || !cart.schedule || Object.keys(cart.schedule).length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // 1. Calculate Subtotal (KES)
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
      await Delivery.insertMany(deliveriesToInsert);

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
      
      // Initialize internal custodial sponsor wallet with 10,000 KES mock signup balance
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

    let emailHtml = `
      <div style="font-family: sans-serif; color: #333;">
        <h2>NutriPay - Student Meal Request</h2>
        <p>Hello ${sponsorName},</p>
        <p>A student has requested you to sponsor their meals totaling <strong>${subtotalKes} KES</strong>.</p>
    `;

    if (isNewSponsor) {
        emailHtml += `
          <p>An account has been automatically created for you. Login with the following credentials to review and fund this request:</p>
          <p><strong>Username / Email:</strong> ${sponsorEmail}</p>
          <p><strong>One-Time Password:</strong> ${generatedPassword}</p>
          <p><em>Please ensure you change your password immediately upon logging in for security purposes.</em></p>
        `;
    } else {
        emailHtml += `
          <p>Please log into your existing NutriPay Sponsor account to review and fund this request.</p>
        `;
    }

    emailHtml += `</div>`;

    try {
      await sendMail({
        to: sponsorEmail,
        subject: "NutriPay - Student Meal Request",
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
          sponsor: sponsor._id, // LINK THE SPONSOR HERE
          items: group.items,
          status: 'awaiting_sponsor',
          totalCost: group.totalCost,
          timeSlot: day.timeSlot || 'Lunch',
          scheduledDate: new Date(date),
          location: 'Campus'
        });
      }
    }
    
    if (deliveriesToInsert.length > 0) {
      await Delivery.insertMany(deliveriesToInsert);
    }

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

module.exports = { getCart, replaceCart, clearCart, checkoutCart, addSponsorCheckout };