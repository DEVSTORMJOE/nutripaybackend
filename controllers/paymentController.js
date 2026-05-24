// controllers/paymentController.js
const CustomOrder = require('../models/CustomOrder');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const walletService = require('../services/walletService');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require("jsonwebtoken");
const admin = require("../config/firebaseAdmin");

// Helper to optionally parse user token (for guest/auth flexibility)
const parseOptionalUser = async (req) => {
  let token = "";
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id || decoded._id || decoded.sub;
    if (userId) {
      const user = await User.findById(userId).select("-password");
      if (user) return user;
    }
  } catch (e) {
    // Try Firebase
    try {
      const decodedFb = await admin.auth().verifyIdToken(token);
      if (decodedFb && decodedFb.uid) {
        const user = await User.findOne({ firebaseUid: decodedFb.uid }).select("-password");
        if (user) return user;
      }
    } catch (fbErr) {}
  }
  return null;
};

// @desc    Process a generic payment (e.g. valid checkout if not subscription)
// @route   POST /api/payment/checkout
// @access  Private
const checkout = async (req, res) => {
  res.json({ message: 'Not implemented for direct checkout yet, use subscriptions or custom orders.' });
};

// @desc    Create a custom instant order
// @route   POST /api/payment/custom-order
// @access  Public (Optionally Authenticated)
const createCustomOrder = async (req, res) => {
  try {
    const {
      paymentMethod, // 'wallet' | 'mpesa_direct'
      vendorId,
      items, // [{ name, quantity, price }]
      totalCost,
      deliveryLocation,
      phone // Override or custom push phone
    } = req.body;

    const user = await parseOptionalUser(req);

    // 1. Validation: Authentication is required, guest checkout is removed
    if (!user) {
      return res.status(401).json({ message: "Authentication required. Please log in or register to place custom orders." });
    }

    if (user.role !== 'student') {
      return res.status(403).json({ message: "Only registered students can place custom orders." });
    }

    // Verify vendor
    let targetVendorId = vendorId;
    if (!targetVendorId && items && items.length > 0) {
      const Meal = require('../models/Meal');
      const mealId = items[0].mealId || items[0].id;
      if (mealId) {
        const mealDoc = await Meal.findById(mealId);
        if (mealDoc && mealDoc.vendor) {
          targetVendorId = mealDoc.vendor.toString();
        }
      }
    }

    if (!targetVendorId) {
      return res.status(400).json({ message: "Vendor ID is required and could not be resolved from items." });
    }

    const vendorProfile = await Vendor.findById(targetVendorId);
    if (!vendorProfile) {
      return res.status(404).json({ message: "Vendor profile not found." });
    }

    const orderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 2. WALLET PAYMENT METHOD
    if (paymentMethod === 'wallet') {
      // Validate availableBalanceKES
      const spendable = await walletService.getSpendableBalance(user._id);
      if (spendable < totalCost) {
        return res.status(400).json({
          message: "Insufficient available wallet balance.",
          availableBalanceKES: spendable,
          requiresMpesaFallback: true
        });
      }

      // Process wallet payment (debit student, split revenue, credit vendor instantly, log)
      await walletService.processWalletCustomOrder(
        user._id,
        vendorProfile.user,
        items,
        totalCost,
        deliveryLocation || user.location,
        user.name,
        user.phone
      );

      // Create CustomOrder record in DB as paid
      const customOrder = await CustomOrder.create({
        orderId,
        user: user._id,
        guestCheckout: false,
        vendor: targetVendorId,
        items,
        totalCost,
        paymentMethod: 'wallet',
        paymentSource: 'student_wallet',
        status: 'preparing', // Paid and instantly in preparation
        deliveryLocation: deliveryLocation || user.location || 'Campus'
      });

      // Notify Vendor
      const Notification = require('../models/Notification');
      await Notification.create({
        user: vendorProfile.user,
        type: 'order',
        title: 'New Instant Custom Order',
        message: `You have a new custom order (${orderId}) of KES ${totalCost}.`
      });

      return res.json({
        success: true,
        message: "Custom order placed successfully using wallet balance!",
        order: customOrder
      });
    }

    // 3. DIRECT MPESA CHECKOUT PAYMENT METHOD
    if (paymentMethod === 'mpesa_direct') {
      const pushPhone = phone || user.phone;
      if (!pushPhone) {
        return res.status(400).json({ message: "Phone number is required for direct M-Pesa push." });
      }

      const reference = crypto.randomUUID();

      // Create pending order
      const customOrder = await CustomOrder.create({
        orderId,
        user: user._id,
        guestCheckout: false,
        vendor: targetVendorId,
        items,
        totalCost,
        paymentMethod: 'mpesa_direct',
        paymentSource: 'mpesa_direct',
        status: 'pending_payment',
        checkoutRequestID: reference,
        deliveryLocation: deliveryLocation || user.location || 'Campus'
      });

      // Trigger PayHero STK Push
      const authHeader = process.env.BASIC_AUTH_TOKEN;
      const channelId = process.env.PAYHERO_CHANNEL_ID;

      if (authHeader && channelId) {
        const baseUrl = process.env.PAYHERO_CALLBACK_URL || 'https://nutripaybackend.onrender.com';
        const callbackUrl = `${baseUrl}/api/payhero/callback/${user ? user._id : 'guest'}`;

        const payload = {
            amount: Number(totalCost),
            phone_number: pushPhone,
            channel_id: Number(channelId),
            provider: "m-pesa",
            external_reference: reference,
            callback_url: callbackUrl
        };

        try {
          const response = await axios.post(
              "https://backend.payhero.co.ke/api/v2/payments",
              payload,
              { headers: { "Content-Type": "application/json", "Authorization": authHeader } }
          );

          if (response.data && response.data.success) {
            return res.json({
              success: true,
              message: "STK Push sent successfully via PayHero! Check your phone...",
              reference,
              orderId
            });
          }
        } catch (err) {
          console.error("PayHero direct order STK Push error:", err.message);
        }
      }

      // Fallback: Safaricom Direct Sandbox STK Push
      const mpesaService = require('../services/mpesaService');
      try {
        const data = await mpesaService.initiateDeposit(user ? user._id : 'guest', pushPhone, totalCost);
        const safaricomID = data.CheckoutRequestID;
        customOrder.checkoutRequestID = safaricomID;
        await customOrder.save();

        return res.json({
          success: true,
          message: "STK Push sent successfully via Safaricom! Please authorize on your phone...",
          reference: safaricomID,
          orderId
        });
      } catch (err) {
        console.error("Direct Safaricom STK Push error:", err.message);
      }

      // Mock checkoutRequestID for demo/prototype mode if both APIs are unavailable
      const mockID = `ws_CO_Mock_${crypto.randomBytes(8).toString('hex')}`;
      customOrder.checkoutRequestID = mockID;
      await customOrder.save();

      return res.json({
        success: true,
        message: "STK Push mock sent successfully! (Demo Sandbox Mode)",
        reference: mockID,
        orderId
      });
    }

  } catch (error) {
    console.error("Create Custom Order Error:", error);
    res.status(500).json({ message: "Failed to process custom order: " + error.message });
  }
};

// @desc    Check custom order status (for polling)
// @route   GET /api/payment/custom-order/status/:reference
// @access  Public
const checkCustomOrderStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const order = await CustomOrder.findOne({ checkoutRequestID: reference });
    if (!order) {
      return res.status(404).json({ message: "Custom order not found." });
    }

    res.json({
      orderId: order.orderId,
      status: order.status,
      totalCost: order.totalCost,
      paymentMethod: order.paymentMethod
    });
  } catch (e) {
    console.error("Status check error:", e);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Admin refund a custom order
// @route   POST /api/payment/custom-order/refund
// @access  Private (Admin)
const refundCustomOrderController = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ message: "Order ID is required." });
    }

    // Standard admin gate check
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: "Unauthorized: Admin access required." });
    }

    const order = await walletService.refundCustomOrder(orderId);
    res.json({ success: true, message: "Custom order successfully refunded!", order });
  } catch (e) {
    res.status(500).json({ message: "Refund failed: " + e.message });
  }
};

module.exports = {
  checkout,
  createCustomOrder,
  checkCustomOrderStatus,
  refundCustomOrderController
};
