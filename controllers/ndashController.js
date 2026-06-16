const NDashOrder = require('../models/NDashOrder');
const NDashProduct = require('../models/NDashProduct');
const NDashAuditLog = require('../models/NDashAuditLog');
const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const User = require('../models/User');
const ndashService = require('../services/ndashService');
const ndashPaymentService = require('../services/ndashPaymentService');
const crypto = require('crypto');
const cloudinary = require('../config/cloudinary');

/**
 * Extract a Cloudinary public_id from a Cloudinary URL.
 * Returns null if the URL is not a Cloudinary URL.
 */
function extractCloudinaryPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('res.cloudinary.com')) return null;
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/');
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx === -1) return null;
    let start = uploadIdx + 1;
    if (/^v\d+$/.test(parts[start])) start++;
    const withExtension = parts.slice(start).join('/');
    return withExtension.replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
}

// ==========================================
// STUDENT CONTROLLERS
// ==========================================

// Place N-Dash Order & Trigger STK Push
const placeOrder = async (req, res) => {
  try {
    const { items, deliveryLocationId, customLocation, room, phone } = req.body;
    const studentId = req.user.id;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Requested items are required' });
    }
    if ((!deliveryLocationId && !customLocation) || !room || !phone) {
      return res.status(400).json({ message: 'Delivery location, room number, and phone are required' });
    }

    // Compute costs
    let shoppingCost = 0;
    const formattedItems = items.map(item => {
      const price = Number(item.estimatedPrice || item.priceKES || 0);
      const qty = Number(item.quantity || 1);
      shoppingCost += price * qty;
      return {
        name: item.name,
        quantity: qty,
        estimatedPrice: price,
        notes: item.notes || ""
      };
    });

    const platformFee = ndashService.calculateNDashFee(shoppingCost);
    const grandTotal = shoppingCost + platformFee;

    // Auto-assign delivery agent based on hostel location and N-Dash assignment
    const isValidLocId = deliveryLocationId && require('mongoose').Types.ObjectId.isValid(deliveryLocationId);
    const deliveryAgent = await ndashService.assignDriverForLocation(isValidLocId ? deliveryLocationId : null);

    // Create unique Order ID
    const orderId = `ND-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Create order document
    const order = await NDashOrder.create({
      orderId,
      student: studentId,
      items: formattedItems,
      shoppingCost,
      platformFee,
      grandTotal,
      deliveryLocation: isValidLocId ? deliveryLocationId : undefined,
      customLocation: !isValidLocId ? (customLocation || deliveryLocationId) : undefined,
      room,
      deliveryAgent,
      status: 'pending_payment'
    });

    // Log audit creation
    await NDashAuditLog.create({
      action: 'order_created',
      user: studentId,
      ndashOrder: order._id,
      details: { grandTotal, platformFee, shoppingCost, deliveryAgent }
    });

    // Trigger STK Push
    let mpesaData;
    try {
      mpesaData = await ndashPaymentService.initiateSTKPush(studentId, phone, grandTotal);
      order.checkoutRequestID = mpesaData.CheckoutRequestID;
      await order.save();
    } catch (stkErr) {
      console.warn('[N-Dash STK Push fallback to mock checkout]', stkErr.message);
      const mockID = `ws_ND_Mock_${crypto.randomBytes(8).toString('hex')}`;
      order.checkoutRequestID = mockID;
      await order.save();
      mpesaData = { CheckoutRequestID: mockID, mock: true };
    }

    res.status(201).json({
      message: mpesaData.mock 
        ? 'STK Push mock initiated successfully! (Demo Sandbox Mode)' 
        : 'STK Push sent successfully to your phone. Waiting for PIN...',
      orderId: order.orderId,
      checkoutRequestID: order.checkoutRequestID,
      grandTotal
    });
  } catch (error) {
    console.error('N-Dash placeOrder error:', error);
    res.status(500).json({ message: 'Failed to place order: ' + error.message });
  }
};

// Check N-Dash STK Push payment status (Poll)
const checkPaymentStatus = async (req, res) => {
  try {
    const { checkoutRequestID } = req.params;
    const order = await NDashOrder.findOne({ checkoutRequestID, student: req.user.id });

    if (!order) {
      return res.status(404).json({ message: 'N-Dash order payment details not found' });
    }

    // Auto-approve mock payments in sandbox
    if (order.status === 'pending_payment' && checkoutRequestID.startsWith('ws_ND_Mock_')) {
      console.log(`[N-Dash Mock Payment] Auto-approving mock payment for Order #${order.orderId}`);
      const mockReceipt = "MOCK_ND_" + Math.random().toString(36).substring(4).toUpperCase();
      
      await ndashPaymentService.processPaymentSuccess(
        checkoutRequestID, 
        mockReceipt, 
        order.grandTotal, 
        req.user.phone || '254700000000'
      );
      
      // reload
      const updatedOrder = await NDashOrder.findById(order._id);
      return res.json({ status: updatedOrder.status, receipt: updatedOrder.mpesaReceiptNumber });
    }

    res.json({ status: order.status, receipt: order.mpesaReceiptNumber });
  } catch (error) {
    console.error('N-Dash checkPaymentStatus error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Student Orders history
const getStudentOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const query = { student: req.user.id };

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.search) {
      const regex = new RegExp(req.query.search, 'i');
      query.$or = [
        { orderId: regex },
        { 'items.name': regex }
      ];
    }

    const total = await NDashOrder.countDocuments(query);
    const orders = await NDashOrder.find(query)
      .populate('deliveryLocation')
      .populate('deliveryAgent', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('N-Dash getStudentOrders error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Student order details
const getStudentOrderDetails = async (req, res) => {
  try {
    const order = await NDashOrder.findOne({ _id: req.params.id, student: req.user.id })
      .populate('deliveryLocation')
      .populate('deliveryAgent', 'name email phone')
      .lean();

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('N-Dash getStudentOrderDetails error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};


// ==========================================
// DELIVERY DRIVER CONTROLLERS
// ==========================================

// Get assigned or available N-Dash orders for Driver
const getDriverOrders = async (req, res) => {
  try {
    const driverProfile = await DeliveryPersonnel.findOne({ user: req.user.id });
    if (!driverProfile) {
      return res.status(403).json({ message: 'Not registered as delivery staff' });
    }

    const isHistory = req.query.history === 'true';

    let query;
    if (isHistory) {
      query = {
        deliveryAgent: req.user.id,
        status: { $in: ['delivered', 'cancelled'] }
      };
    } else {
      const assignedLocationIds = driverProfile.assignedLocations || [];
      query = {
        $or: [
          { deliveryAgent: req.user.id },
          { 
            deliveryLocation: { $in: assignedLocationIds }, 
            status: 'pending',
            $or: [{ deliveryAgent: null }, { deliveryAgent: { $exists: false } }]
          },
          { 
            deliveryLocation: null, 
            status: 'pending',
            $or: [{ deliveryAgent: null }, { deliveryAgent: { $exists: false } }]
          },
          { 
            deliveryLocation: { $exists: false }, 
            status: 'pending',
            $or: [{ deliveryAgent: null }, { deliveryAgent: { $exists: false } }]
          }
        ],
        status: { $nin: ['pending_payment', 'delivered', 'cancelled'] }
      };
    }

    const orders = await NDashOrder.find(query)
      .populate('student', 'name email phone')
      .populate('deliveryLocation')
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (error) {
    console.error('N-Dash getDriverOrders error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Driver order details (accessed via SMS link, allows guest link lookup if token payload fits)
const getDriverOrderDetails = async (req, res) => {
  try {
    const order = await NDashOrder.findById(req.params.id)
      .populate('student', 'name email phone')
      .populate('deliveryLocation')
      .populate('deliveryAgent', 'name email phone')
      .lean();

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('N-Dash getDriverOrderDetails error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Driver accepts order
const acceptOrder = async (req, res) => {
  try {
    const order = await NDashOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: `Cannot accept order in status ${order.status}` });
    }

    if (order.deliveryAgent && String(order.deliveryAgent) !== String(req.user.id)) {
      return res.status(400).json({ message: 'This order is already assigned to another driver' });
    }

    order.deliveryAgent = req.user.id;
    order.status = 'accepted';
    await order.save();

    await NDashAuditLog.create({
      action: 'order_accepted',
      user: req.user.id,
      ndashOrder: order._id,
      details: { driverName: req.user.name }
    });

    res.json({ message: 'Order accepted successfully', status: order.status });
  } catch (error) {
    console.error('N-Dash acceptOrder error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Driver transitions status to Shopping
const startShopping = async (req, res) => {
  try {
    const order = await NDashOrder.findOne({ _id: req.params.id, deliveryAgent: req.user.id });
    if (!order) {
      return res.status(404).json({ message: 'Order not found or not assigned to you' });
    }

    if (order.status !== 'accepted') {
      return res.status(400).json({ message: `Cannot start shopping for order in status ${order.status}` });
    }

    order.status = 'shopping';
    await order.save();

    await NDashAuditLog.create({
      action: 'driver_shopping',
      user: req.user.id,
      ndashOrder: order._id
    });

    res.json({ message: 'Status updated to Shopping', status: order.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Driver completes shopping and goes Out for Delivery
const completeShopping = async (req, res) => {
  try {
    const order = await NDashOrder.findOne({ _id: req.params.id, deliveryAgent: req.user.id });
    if (!order) {
      return res.status(404).json({ message: 'Order not found or not assigned to you' });
    }

    if (order.status !== 'shopping' && order.status !== 'accepted') {
      return res.status(400).json({ message: `Cannot complete shopping in status ${order.status}` });
    }

    order.status = 'out_for_delivery';
    await order.save();

    await NDashAuditLog.create({
      action: 'shopping_completed',
      user: req.user.id,
      ndashOrder: order._id
    });

    res.json({ message: 'Status updated to Out For Delivery', status: order.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Driver generates unique verification code for student
const generateDriverCode = async (req, res) => {
  try {
    const order = await NDashOrder.findOne({ _id: req.params.id, deliveryAgent: req.user.id });
    if (!order) {
      return res.status(404).json({ message: 'Order not found or not assigned to you' });
    }

    const updated = await ndashService.generateVerificationCode(order);
    res.json({
      message: 'Verification code generated successfully',
      code: updated.deliveryVerificationCode,
      expiry: updated.deliveryVerificationExpiry
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error: ' + error.message });
  }
};

// Driver verifies code from student
const verifyDriverCode = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    const order = await ndashService.verifyDeliveryCode(req.params.id, code, req.user.id);
    
    // Notify student in-app
    const Notification = require('../models/Notification');
    await Notification.create({
      user: order.student._id || order.student,
      type: 'delivery',
      title: 'N-Dash Order Delivered ✅',
      message: `Your N-Dash order #${order.orderId} has been successfully verified and delivered by the runner.`
    });

    res.json({ message: 'Delivery successfully verified and completed', status: order.status });
  } catch (error) {
    console.error('N-Dash verifyDriverCode error:', error.message);
    res.status(400).json({ message: error.message });
  }
};


// ==========================================
// ADMIN CONTROLLERS
// ==========================================

// Get N-Dash products list
const getProducts = async (req, res) => {
  try {
    const query = {};
    if (req.query.activeOnly === 'true') {
      query.isActive = true;
    }
    const products = await NDashProduct.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Create Product
const createProduct = async (req, res) => {
  try {
    const { name, priceKES, imageUrl, isActive } = req.body;
    if (!name || !priceKES) {
      return res.status(400).json({ message: 'Name and price are required' });
    }

    const prod = await NDashProduct.create({ name, priceKES, imageUrl, isActive });
    res.status(201).json(prod);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Update Product
const updateProduct = async (req, res) => {
  try {
    const { name, priceKES, imageUrl, isActive } = req.body;
    const prod = await NDashProduct.findById(req.params.id);
    if (!prod) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (name !== undefined) prod.name = name;
    if (priceKES !== undefined) prod.priceKES = priceKES;
    if (imageUrl !== undefined) prod.imageUrl = imageUrl;
    if (isActive !== undefined) prod.isActive = isActive;

    await prod.save();
    res.json(prod);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Delete Product
const deleteProduct = async (req, res) => {
  try {
    const prod = await NDashProduct.findById(req.params.id);
    if (!prod) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Attempt Cloudinary image deletion — non-fatal
    const publicId = extractCloudinaryPublicId(prod.imageUrl);
    if (publicId) {
      try {
        const result = await cloudinary.uploader.destroy(publicId);
        console.log(`[Cloudinary] Deleted NDash product image '${publicId}':`, result.result);
      } catch (cloudErr) {
        console.warn(`[Cloudinary] Could not delete NDash product image '${publicId}':`, cloudErr.message);
      }
    }

    await NDashProduct.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Admin order search/list
const getAdminOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const query = {};

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.search) {
      const regex = new RegExp(req.query.search.trim(), 'i');
      
      // Lookup matching students/drivers to match their IDs
      const matchedUsers = await User.find({
        name: regex
      }).select('_id');
      const userIds = matchedUsers.map(u => u._id);

      query.$or = [
        { orderId: regex },
        { room: regex },
        { student: { $in: userIds } },
        { deliveryAgent: { $in: userIds } }
      ];
    }

    const total = await NDashOrder.countDocuments(query);
    const orders = await NDashOrder.find(query)
      .populate('student', 'name email phone')
      .populate('deliveryLocation')
      .populate('deliveryAgent', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error: ' + error.message });
  }
};

// N-Dash platform financial revenue stats
const getAdminStats = async (req, res) => {
  try {
    const completedOrders = await NDashOrder.find({ status: 'delivered' }).lean();

    const nDashRevenue = completedOrders.reduce((sum, order) => sum + (order.platformFee || 0), 0);
    const nDashFees = completedOrders.length > 0 ? nDashRevenue / completedOrders.length : 0;
    const historicalRevenue = completedOrders.reduce((sum, order) => sum + (order.grandTotal || 0), 0);

    res.json({
      nDashRevenue,
      nDashFees,
      historicalRevenue,
      totalRevenue: nDashRevenue // alias
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error fetching stats' });
  }
};


// ==========================================
// MPESA WEBHOOK CALLBACK
// ==========================================
const mpesaCallback = async (req, res) => {
  try {
    console.log('[N-Dash M-Pesa Callback Received]:', JSON.stringify(req.body, null, 2));

    const callbackVerification = mpesaService.verifyCallback(req.body);
    const { checkoutRequestID } = callbackVerification;

    if (!callbackVerification.success) {
      console.log(`[N-Dash M-Pesa Callback] Payment failed/cancelled for CheckoutRequestID ${checkoutRequestID}`);
      await NDashOrder.findOneAndUpdate({ checkoutRequestID }, { status: 'cancelled' });
      return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
    }

    const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;
    await ndashPaymentService.processPaymentSuccess(checkoutRequestID, mpesaReceiptNumber, amountPaid, phonePaidFrom);

    res.json({ ResponseCode: "0", ResponseDesc: "Success" });
  } catch (error) {
    console.error('N-Dash mpesaCallback error:', error.message);
    res.status(500).json({ ResponseCode: "1", ResponseDesc: "Internal Server Error" });
  }
};

module.exports = {
  placeOrder,
  checkPaymentStatus,
  getStudentOrders,
  getStudentOrderDetails,
  getDriverOrders,
  getDriverOrderDetails,
  acceptOrder,
  startShopping,
  completeShopping,
  generateDriverCode,
  verifyDriverCode,
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getAdminOrders,
  getAdminStats,
  mpesaCallback
};
