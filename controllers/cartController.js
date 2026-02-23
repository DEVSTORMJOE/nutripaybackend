const Cart = require("../models/Cart");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const stellarService = require("../services/stellarService");

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

    // 3. Find a Destination Wallet for the payment
    // For MVP, look for the first vendor wallet, or auto-provision one if none exists so testnet transactions pass.
    let vendorWallet = await Wallet.findOne({ walletType: 'vendor' });

    if (!vendorWallet) {
        console.log(`Provisioning default Vendor wallet for testnet checkouts.`);
        
        const User = require("../models/User");
        let vendorUser = await User.findOne({ role: 'vendor' });
        
        if (!vendorUser) {
            console.log("No vendor user found. Creating a mock vendor user to receive funds.");
            vendorUser = await User.create({
                name: "Mock Vendor",
                email: "mockvendor@nutripay.local",
                password: "hashedpassword123", // bypassing auth logic just for mock
                role: "vendor"
            });
        }

        const vendorKeypair = await stellarService.createWallet();
        
        vendorWallet = await Wallet.create({
            user: vendorUser._id,
            stellarPublicKey: vendorKeypair.publicKey,
            stellarSecretKey: vendorKeypair.secret,
            walletType: 'vendor',
            balance: 0
        });
    }

    let destinationPublicKey;
    let destinationWalletId = null;

    if (vendorWallet) {
        destinationPublicKey = vendorWallet.stellarPublicKey;
        destinationWalletId = vendorWallet._id;
    } else {
        // Ultimate Fallback: Platform Key
        if (!stellarService.platformKey) {
             return res.status(500).json({ message: "No destination platform vendors found for checkout." });
        }
        destinationPublicKey = stellarService.platformKey.publicKey();
    }

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

    if (vendorWallet) {
        vendorWallet.balance += subtotalKes;
        await vendorWallet.save();
    }

    // 7. Clear Cart
    await Cart.findOneAndUpdate({ user: userId }, { schedule: {} });

    return res.json({ ok: true, txHash: tx.hash, newBalance: studentWallet.balance });
  } catch (e) {
    console.error("Checkout failed:", e);
    return res.status(500).json({ message: "Checkout Payment failed on network: " + (e.message || "Unknown error") });
  }
}

module.exports = { getCart, replaceCart, clearCart, checkoutCart };