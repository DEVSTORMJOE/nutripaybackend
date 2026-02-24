const Cart = require("../models/Cart");
const Wallet = require("../models/Wallet");
const stellarService = require("../services/stellarService");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Delivery = require("../models/Delivery");
const crypto = require("crypto");
const { sendMail } = require("../utils/mailer");

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

    // 2. Fetch Student Wallet
    let studentWallet = await Wallet.findOne({ user: userId }).select('+stellarSecretKey');
    
    // Automatically provision wallet if missing
    if (!studentWallet) {
        console.log(`Provisioning missing Stellar wallet for user ${userId} during cart checkout.`);
        const keypair = await stellarService.createWallet();
        studentWallet = await Wallet.create({
            user: userId,
            stellarPublicKey: keypair.publicKey,
            stellarSecretKey: keypair.secret,
            walletType: req.user.role || 'student',
            balance: 0
        });
    }

    if (!studentWallet || !studentWallet.stellarSecretKey) {
      return res.status(400).json({ message: "Student stellar wallet could not be accessed. Please contact support." });
    }

    // Ensure student wallet balance (KES display)
    if (studentWallet.balance < subtotalKes) {
      return res.status(400).json({ message: "Insufficient balance for this checkout." });
    }

    // 3. Find the Escrow (Admin) Wallet for the payment
    // We will look for an Admin wallet to hold funds in escrow.
    let adminWallet = await Wallet.findOne({ walletType: 'admin' });

    if (!adminWallet) {
        console.log(`Provisioning default Admin escrow wallet for checkouts.`);
        
        let adminUser = await User.findOne({ role: 'admin' });
        
        if (!adminUser) {
            console.log("No admin user found. Creating a mock admin user for escrow.");
            adminUser = await User.create({
                name: "Admin Escrow",
                email: "admin@nutripay.local",
                password: "hashedpassword123", // bypassing auth
                role: "admin"
            });
        }

        const adminKeypair = await stellarService.createWallet();
        
        adminWallet = await Wallet.create({
            user: adminUser._id,
            stellarPublicKey: adminKeypair.publicKey,
            stellarSecretKey: adminKeypair.secret,
            walletType: 'admin',
            balance: 0
        });
    }

    let destinationPublicKey = adminWallet.stellarPublicKey;
    let destinationWalletId = adminWallet._id;

    // 4. Call Stellar Service Make Payment (KES to XLM handles inside)
    const tx = await stellarService.makePayment(studentWallet.stellarSecretKey, destinationPublicKey, subtotalKes);

    // 5. Log Transaction
    await Transaction.create({
      fromWallet: studentWallet._id,
      toWallet: destinationWalletId, // May be null if fallback used
      amount: subtotalKes,
      type: 'payment',
      stellarTxHash: tx.hash,
      description: `Cart checkout for ${Object.keys(cart.schedule).length} days`,
      status: 'completed'
    });

    // 6. Update local KES balances optimistically
    studentWallet.balance -= subtotalKes;
    await studentWallet.save();

    adminWallet.balance += subtotalKes;
    await adminWallet.save();

    // 6.5. Create Deliveries for the scheduled days
    // For MVP, we'll assign deliveries to the first available vendor
    let vendorUser = await User.findOne({ role: 'vendor' });
    const vendorId = vendorUser ? vendorUser._id : null;
    
    if (vendorId) {
      const deliveriesToInsert = [];
      for (const date of Object.keys(cart.schedule)) {
        const day = cart.schedule[date];
        if (!day) continue;
        const qty = Math.max(1, Number(day.qty || 1));
        const items = [];
        if (day.main) items.push({ name: day.main.name, quantity: qty });
        if (day.drink) items.push({ name: day.drink.name, quantity: qty });
        if (day.fruit) items.push({ name: day.fruit.name, quantity: qty });

        const dayTotalCost = (
          (day.main ? Number(day.main.price) : 0) +
          (day.drink ? Number(day.drink.price) : 0) +
          (day.fruit ? Number(day.fruit.price) : 0)
        ) * qty;

        if (items.length > 0) {
          deliveriesToInsert.push({
            student: userId,
            vendor: vendorId,
            items: items,
            status: 'pending',
            totalCost: dayTotalCost,
            timeSlot: day.timeSlot || 'Lunch',
            scheduledDate: new Date(date),
            location: 'Campus' // Default location for now
          });
        }
      }
      
      if (deliveriesToInsert.length > 0) {
        await Delivery.insertMany(deliveriesToInsert);
      }
    }

    // 7. Clear Cart
    await Cart.findOneAndUpdate({ user: userId }, { schedule: {} });

    return res.json({ ok: true, txHash: tx.hash, newBalance: studentWallet.balance });
  } catch (e) {
    console.error("Checkout failed:", e);
    return res.status(500).json({ message: "Checkout Payment failed on network: " + (e.message || "Unknown error") });
  }
}

async function addSponsorCheckout(req, res) {
  try {
    const userId = req.user.id;
    const { sponsorName, sponsorPhone, sponsorEmail } = req.body;

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
      generatedPassword = crypto.randomBytes(4).toString("hex"); // e.g., 8 character random string

      sponsor = await User.create({
        name: sponsorName,
        email: sponsorEmail,
        password: generatedPassword, 
        role: "sponsor",
      });
      // Optionally create a wallet for the sponsor here
      const keypair = await stellarService.createWallet();
      await Wallet.create({
          user: sponsor._id,
          stellarPublicKey: keypair.publicKey,
          stellarSecretKey: keypair.secret,
          walletType: "sponsor",
          balance: 0
      });
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

    // Clear the cart since the responsibility has shifted to the Sponsor
    // (In a fuller implementation, we might save this Cart as an 'Order/Request' linked to the Sponsor)
    // For MVP, we will just inform the student it was sent and clear cart (or leave it in pending state).
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