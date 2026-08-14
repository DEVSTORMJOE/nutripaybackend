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

      // Inherit student hostel DeliveryLocation and create immediate Delivery record
      const Student = require('../models/Student');
      const DeliveryLocation = require('../models/DeliveryLocation');
      const studentProfile = await Student.findOne({ user: user._id });
      const Delivery = require('../models/Delivery');

      // Resolve deliveryLocation ObjectId — use stored ID or resolve from hostel string
      let resolvedLocId = studentProfile?.deliveryLocation || null;
      let resolvedLocName = studentProfile?.hostel || '';
      if (!resolvedLocId && resolvedLocName && resolvedLocName !== 'Campus') {
        const dl = await DeliveryLocation.findOne({
          hostelResidence: new RegExp(resolvedLocName.trim(), 'i')
        });
        if (dl) {
          resolvedLocId = dl._id;
          // Persist the resolved deliveryLocation back to the student profile
          await Student.updateOne({ user: user._id }, { deliveryLocation: dl._id });
        }
      }
      // Build a full location description string for the driver
      const locationParts = [
        resolvedLocName || 'Campus',
        studentProfile?.block ? `Block ${studentProfile.block}` : null,
        studentProfile?.floor ? `Floor ${studentProfile.floor}` : null,
        studentProfile?.room ? `Room ${studentProfile.room}` : null,
        studentProfile?.landmark ? `(${studentProfile.landmark})` : null,
      ].filter(Boolean);
      const fullLocation = locationParts.join(', ');

      await Delivery.create({
        student: user._id,
        vendor: targetVendorId,
        items: items,
        status: 'pending',
        totalCost: totalCost,
        timeSlot: (() => {
          const now = new Date();
          const kenyaHour = (now.getUTCHours() + 3) % 24;
          if (kenyaHour < 10) return 'Breakfast';
          if (kenyaHour < 14) return 'Lunch';
          if (kenyaHour < 20) return 'Supper';
          return 'Breakfast'; // past supper cutoff, push to breakfast
        })(),
        scheduledDate: (() => {
          const now = new Date();
          const kenyaHour = (now.getUTCHours() + 3) % 24;
          if (kenyaHour >= 20) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow;
          }
          return now;
        })(),
        location: fullLocation || deliveryLocation || 'Campus',
        deliveryLocation: resolvedLocId || null,
        isCustom: true
      });

      // Notify Vendor
      const Notification = require('../models/Notification');
      const mealPrice = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
      await Notification.create({
        user: vendorProfile.user,
        type: 'order',
        title: 'New Instant Custom Order',
        message: `You have a new custom order (${orderId}) of KES ${mealPrice}.`
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

      // Payment gateway unified STK Push
      const paymentGatewayService = require('../services/paymentGatewayService');
      try {
        const data = await paymentGatewayService.initiateDeposit(user ? user._id : 'guest', pushPhone, totalCost, 'quick_order');
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

      // Mock checkoutRequestID for demo/prototype mode if Safaricom API is unavailable
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

    // Auto-approve mock sandbox checkouts immediately upon polling
    if (reference.startsWith("ws_CO_Mock_") && order.status === "pending_payment") {
      console.log(`[Mock STK Push] Auto-approving mock custom order: ${order.orderId}`);
      await walletService.processMpesaDirectCustomOrder(
        reference,
        order.totalCost,
        "MOCK_STK_" + Math.random().toString(36).substring(4).toUpperCase(),
        "254700000000"
      );
      
      const updated = await CustomOrder.findById(order._id);
      return res.json({
        orderId: updated.orderId,
        status: updated.status,
        totalCost: updated.totalCost,
        paymentMethod: updated.paymentMethod
      });
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
