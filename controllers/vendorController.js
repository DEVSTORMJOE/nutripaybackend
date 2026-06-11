const Meal = require('../models/Meal');
const Subscription = require('../models/Subscription');
const Wallet = require('../models/Wallet');
const Delivery = require('../models/Delivery');
const Transaction = require('../models/Transaction');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const stellarService = require('../services/stellarService');

// @desc    Get vendor dashboard stats
// @route   GET /api/vendor/dashboard
// @access  Private (Vendor)
const getDashboard = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor profile not found' });

    const plans = await Meal.countDocuments({ vendor: vendorRecord._id });
    const activeSubs = await Subscription.countDocuments({
      meal: { $in: await Meal.find({ vendor: vendorRecord._id }).select('_id') },
      status: 'active'
    });
    const wallet = await Wallet.findOne({ user: req.user.id });

    let balance = wallet ? wallet.balance : 0;

    // Fetch live balance from Stellar Network
    try {
      if (wallet && wallet.stellarPublicKey) {
        const liveXlmBalance = await stellarService.getBalance(wallet.stellarPublicKey);
        if (liveXlmBalance !== null) {
          const liveKesBalance = stellarService.XLM_to_KES(liveXlmBalance);
          
          if (!isNaN(liveKesBalance) && parseFloat(liveKesBalance) >= 0) {
              balance = parseFloat(liveKesBalance);
              wallet.balance = balance;
              await wallet.save();
          }
        }
      }
    } catch (stellarError) {
      console.error("Failed to fetch live Stellar balance, falling back to MongoDB cache:", stellarError);
    }

    res.json({
      activePlans: plans,
      activeSubscriptions: activeSubs,
      balance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a meal
// @route   POST /api/vendor/meals
// @access  Private (Vendor)
const createMeal = async (req, res) => {
  const { name, category, price, description, imageUrl, nutrition, currency } = req.body;

  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor profile not found' });

    const meal = await Meal.create({
      vendor: vendorRecord._id,
      name,
      category,
      price,
      description,
      imageUrl,
      nutrition,
      currency: currency || "KES"
    });

    res.status(201).json(meal);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get vendor meals
// @route   GET /api/vendor/meals
// @access  Private (Vendor)
const getMeals = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.json([]);

    const meals = await Meal.find({ vendor: vendorRecord._id });
    res.json(meals);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get orders (Deliveries effectively)
// @route   GET /api/vendor/orders
// @access  Private (Vendor)
const getOrders = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.json([]);

    const deliveries = await Delivery.find({ vendor: vendorRecord._id, isCustom: { $ne: true } })
      .populate('student', 'name email')
      .populate('deliveryAgent', 'name email phone')
      .populate('deliveryLocation', 'hostelResidence campus university')
      .sort({ createdAt: -1 });

    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get custom/quick orders (deliveries) for the vendor
// @route   GET /api/vendor/orders/quick
// @access  Private (Vendor)
const getQuickOrders = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor profile not found' });

    const deliveries = await Delivery.find({ vendor: vendorRecord._id, isCustom: true })
      .populate('student', 'name email phone')
      .populate('deliveryAgent', 'name email')
      .populate('deliveryLocation', 'hostelResidence campus university')
      .sort({ createdAt: -1 });

    res.json(deliveries);
  } catch (error) {
    console.error("Get Vendor Quick Orders Error:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Update an order/delivery status
// @route   PUT /api/vendor/orders/:id
// @access  Private (Vendor)
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, deliveryAgent } = req.body;
    
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });

    const delivery = await Delivery.findOne({ _id: id, vendor: vendorRecord._id });
    if (!delivery) return res.status(404).json({ message: 'Order not found' });

    // Track delivery agent if provided (e.g., when moving to assigned)
    if (deliveryAgent) {
      delivery.deliveryAgent = deliveryAgent;
    }

    // Payment Logic: If marking as 'delivered' from a 'pending'/'assigned'/'picked_up' state
    if (status === 'delivered' && delivery.status !== 'delivered') {
      const payoutKes = Number(delivery.totalCost || 0);
      
      if (payoutKes > 0) {
        // Find Admin Escrow Wallet and Vendor Wallet
        const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');
        const vendorWallet = await Wallet.findOne({ user: req.user.id });

        if (!adminWallet || !adminWallet.stellarSecretKey || !vendorWallet) {
          return res.status(500).json({ message: 'Wallet information missing. Cannot process vendor payout.' });
        }

        // Payout from Admin to Vendor
        const tx = await stellarService.makePayment(
          adminWallet.stellarSecretKey,
          vendorWallet.stellarPublicKey,
          payoutKes
        );

        // Log Payout Transaction
        await Transaction.create({
          fromWallet: adminWallet._id,
          toWallet: vendorWallet._id,
          amount: payoutKes,
          type: 'payout',
          stellarTxHash: tx.hash,
          description: `Payout for completed delivery ${delivery._id}`,
          status: 'completed'
        });

        // Update local balances
        adminWallet.balance -= payoutKes;
        await adminWallet.save();

        vendorWallet.balance += payoutKes;
        await vendorWallet.save();
      }
    }

    if (status === 'ready') {
      if (!delivery.deliveryVerificationCode) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const part1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        delivery.deliveryVerificationCode = `NP-${part1}-${part2}`;
        
        const expiry = new Date();
        expiry.setHours(23, 59, 59, 999);
        delivery.deliveryVerificationExpiry = expiry;
      }

      // Auto-assign approved driver mapped to this student's hostel delivery location
      if (!delivery.deliveryAgent) {
        const DeliveryPersonnel = require('../models/DeliveryPersonnel');
        const DeliveryLocation = require('../models/DeliveryLocation');

        let locId = delivery.deliveryLocation;

        // Self-Healing Fallback: if no deliveryLocation ObjectId, try to lookup from Student profile
        if (!locId && delivery.student) {
          const Student = require('../models/Student');
          const studentProfile = await Student.findOne({ user: delivery.student });
          if (studentProfile && studentProfile.deliveryLocation) {
            locId = studentProfile.deliveryLocation;
            delivery.deliveryLocation = studentProfile.deliveryLocation;
            if (studentProfile.hostelResidence) {
              delivery.location = studentProfile.hostelResidence;
            }
            console.log(`[AutoAssign] Healed order using Student profile. Set location to "${delivery.location}" and ID: ${locId}`);
          }
        }

        // Fallback: if no deliveryLocation ObjectId but location string exists, resolve it
        if (!locId && delivery.location) {
          const dl = await DeliveryLocation.findOne({
            hostelResidence: new RegExp('^' + delivery.location.trim().split(/\s+/)[0], 'i')
          });
          if (dl) {
            locId = dl._id;
            delivery.deliveryLocation = dl._id;
            console.log(`[AutoAssign] Resolved location string "${delivery.location}" to DeliveryLocation: ${dl._id}`);
          }
        }

        if (locId) {
          const candidateStaff = await DeliveryPersonnel.find({
            assignedLocations: locId,
            approvedStatus: 'approved',
            assignmentType: { $in: ['meal_delivery', 'both'] }
          }).populate('user');

          if (candidateStaff.length > 0) {
            const NDashOrder = require('../models/NDashOrder');
            const staffJobs = await Promise.all(
              candidateStaff.map(async (staff) => {
                if (!staff.user) return { staff, count: Infinity };
                const mealCount = await Delivery.countDocuments({
                  deliveryAgent: staff.user._id,
                  status: { $in: ['assigned', 'picked_up'] }
                });
                const ndashCount = await NDashOrder.countDocuments({
                  deliveryAgent: staff.user._id,
                  status: { $in: ['pending', 'accepted', 'shopping', 'out_for_delivery'] }
                });
                return { staff, count: mealCount + ndashCount };
              })
            );

            const validJobs = staffJobs.filter(j => j.staff.user);
            if (validJobs.length > 0) {
              validJobs.sort((a, b) => a.count - b.count);
              const assignedStaff = validJobs[0].staff;
              delivery.deliveryAgent = assignedStaff.user._id;
              console.log(`[AutoAssign] Driver auto-assigned: userId=${assignedStaff.user._id} for location=${locId} with active count=${validJobs[0].count}`);
            } else {
              console.warn(`[AutoAssign] No valid user linked to driver profiles for location=${locId}`);
            }
          } else {
            console.warn(`[AutoAssign] No approved driver found for location=${locId}`);
          }
        } else {
          console.warn(`[AutoAssign] No deliveryLocation found on order ${delivery._id}`);
        }
      }

      // If a driver is now set (either previously or newly assigned), automatically advance status to 'assigned'
      if (delivery.deliveryAgent) {
        delivery.status = 'assigned';
      } else {
        delivery.status = 'ready';
      }
    } else {
      delivery.status = status;
    }

    await delivery.save();

    res.json(delivery);
  } catch (error) {
    console.error("Update Order Status Error:", error);
    res.status(500).json({ message: 'Failed to update order and process payout: ' + (error.message || 'Unknown network error') });
  }
};

// @desc    Get vendor's delivery staff
// @route   GET /api/vendor/delivery-staff
// @access  Private (Vendor)
const getDeliveryStaff = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id }).populate('deliveryStaff', '-password');
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });
    
    // Check for active deliveries to determine assignment status
    const activeDeliveries = await Delivery.find({
      vendor: vendorRecord._id,
      status: { $in: ['assigned', 'picked_up'] }
    });

    const assignedDriverIds = activeDeliveries.map(d => d.deliveryAgent?.toString()).filter(Boolean);

    // We map delivery staff into a structure that matches the frontend
    const staff = vendorRecord.deliveryStaff.map(s => ({
      _id: s._id,
      name: s.name,
      email: s.email,
      phone: s.phone || "Not Provided",
      status: assignedDriverIds.includes(s._id.toString()) ? "Assigned" : "Available",
      deliveries: 0,
      rating: 5.0
    }));

    res.json(staff);
  } catch (error) {
    console.error("Get Delivery Staff Error:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Register a new delivery staff
// @route   POST /api/vendor/delivery-staff
// @access  Private (Vendor)
const registerDeliveryStaff = async (req, res) => {
  try {
    const { name, email, password, phone, idNumber } = req.body;
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });

    // Validate we got an email and password
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    const newDriver = await User.create({
      name,
      email,
      phone,
      password, // User model will hash this on save
      role: 'delivery',
      requiresPasswordChange: true
    });

    vendorRecord.deliveryStaff.push(newDriver._id);
    await vendorRecord.save();

    res.status(201).json({
      _id: newDriver._id,
      name: newDriver.name,
      email: newDriver.email,
      phone: phone,
      status: "Available",
      deliveries: 0,
      rating: 5.0
    });
  } catch (error) {
    console.error("Register Delivery Staff Error:", error);
    res.status(500).json({ message: 'Server Error: ' + error.message });
  }
};

// @desc    Add a location
// @route   POST /api/vendor/locations
// @access  Private (Vendor)
const addLocation = async (req, res) => {
  try {
    const { name, address, hours, status } = req.body;
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });

    vendorRecord.locations.push({ name, address, hours, status });
    await vendorRecord.save();
    res.status(201).json(vendorRecord.locations);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get locations
// @route   GET /api/vendor/locations
// @access  Private (Vendor)
const getLocations = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });
    res.json(vendorRecord.locations || []);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Delete location
// @route   DELETE /api/vendor/locations/:locId
// @access  Private (Vendor)
const deleteLocation = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });
    
    vendorRecord.locations.id(req.params.locId).deleteOne();
    await vendorRecord.save();
    res.json(vendorRecord.locations);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const submitMealForApproval = async (req, res) => {
  const { id } = req.params;
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });

    const meal = await Meal.findOne({ _id: id, vendor: vendorRecord._id });
    if (!meal) return res.status(404).json({ message: 'Meal not found' });

    if (meal.approvalStatus !== 'draft' && meal.approvalStatus !== 'rejected') {
      return res.status(400).json({ message: `Cannot submit a meal with status ${meal.approvalStatus}` });
    }

    meal.approvalStatus = 'pending';
    await meal.save();

    res.json({ message: "Meal submitted for approval successfully!", meal });
  } catch (error) {
    console.error("Submit Meal Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Get order changes & cancellations for vendor
// @route   GET /api/vendor/orders/meal-changes
// @access  Private (Vendor)
const getOrderChangesLog = async (req, res) => {
  try {
    const vendorRecord = await Vendor.findOne({ user: req.user.id });
    if (!vendorRecord) return res.status(404).json({ message: 'Vendor not found' });

    const MealChangeLog = require('../models/MealChangeLog');
    
    // Fetch meal changes where the delivery is for this vendor
    const mealChanges = await MealChangeLog.find()
      .populate({
        path: 'deliveryId',
        match: { vendor: vendorRecord._id },
        select: 'scheduledDate timeSlot location items totalCost'
      })
      .populate('student', 'name email')
      .sort({ createdAt: -1 })
      .lean();
      
    // Filter out meal changes where the delivery was not for this vendor
    const vendorMealChanges = mealChanges.filter(c => c.deliveryId !== null && c.deliveryId !== undefined);

    // Fetch cancelled deliveries for this vendor
    const cancelledDeliveries = await Delivery.find({
      vendor: vendorRecord._id,
      status: 'cancelled'
    })
    .populate('student', 'name email')
    .sort({ updatedAt: -1 })
    .lean();

    res.json({
      mealChanges: vendorMealChanges,
      cancellations: cancelledDeliveries
    });
  } catch (error) {
    console.error("Get Order Changes Log Error:", error);
    res.status(500).json({ message: "Failed to load vendor activity log" });
  }
};

module.exports = {
  getDashboard,
  addLocation,
  getLocations,
  deleteLocation,
  createMeal,
  getMeals,
  getOrders,
  getQuickOrders,
  updateOrderStatus,
  getDeliveryStaff,
  registerDeliveryStaff,
  submitMealForApproval,
  getOrderChangesLog,
};

