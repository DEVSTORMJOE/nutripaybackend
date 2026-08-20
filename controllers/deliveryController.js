// const Delivery = require('../models/Delivery');
// const Wallet = require('../models/Wallet');
// const Transaction = require('../models/Transaction');
// const stellarService = require('../services/stellarService');

// // @desc    Get assigned deliveries
// // @route   GET /api/delivery/assigned
// // @access  Private (Delivery)
// const getAssignedDeliveries = async (req, res) => {
//   try {
//     const deliveries = await Delivery.find({ deliveryAgent: req.user.id, status: { $ne: 'delivered' } })
//       .populate('student', 'name email')
//       .populate({
//         path: 'vendor',
//         populate: { path: 'user', select: 'name email' }
//       });
//     res.json(deliveries);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: 'Server Error' });
//   }
// };

// // @desc    Mark delivery as complete
// // @route   POST /api/delivery/complete
// // @access  Private (Delivery)
// const markDelivered = async (req, res) => {
//   const { deliveryId } = req.body;

//   try {
//     const delivery = await Delivery.findOne({ _id: deliveryId, deliveryAgent: req.user.id }).populate('vendor');
//     if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

//     if (delivery.status !== 'delivered') {
//       const payoutKes = Number(delivery.totalCost || 0);

//       if (payoutKes > 0) {
//         // Find Admin Escrow Wallet and Vendor Wallet
//         const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');
//         const vendorWallet = await Wallet.findOne({ user: delivery.vendor.user }); // vendor.user is the User ObjectId

//         if (adminWallet && adminWallet.stellarSecretKey && vendorWallet) {
//           try {
//             // Payout from Admin to Vendor
//             const tx = await stellarService.makePayment(
//               adminWallet.stellarSecretKey,
//               vendorWallet.stellarPublicKey,
//               payoutKes
//             );

//             // Log Payout Transaction
//             await Transaction.create({
//               fromWallet: adminWallet._id,
//               toWallet: vendorWallet._id,
//               amount: payoutKes,
//               type: 'payout',
//               stellarTxHash: tx.hash,
//               description: `Payout for completed delivery ${delivery._id}`,
//               status: 'completed'
//             });

//             // Update local balances
//             adminWallet.balance -= payoutKes;
//             await adminWallet.save();

//             vendorWallet.balance += payoutKes;
//             await vendorWallet.save();
//           } catch (payoutError) {
//             console.error("Payout failed during delivery completion:", payoutError);
//             return res.status(500).json({ message: 'Delivery marked but payout failed: ' + (payoutError.message || 'Unknown error') });
//           }
//         } else {
//             console.warn("Wallet information missing. Cannot process vendor payout.");
//         }
//       }
//     }

//     delivery.status = 'delivered';
//     delivery.deliveredAt = Date.now();
//     await delivery.save();

//     const Notification = require('../models/Notification');
//     if (delivery.vendor && delivery.vendor.user) {
//       await Notification.create({
//         user: delivery.vendor.user,
//         type: 'alert',
//         title: 'Delivery Completed',
//         message: `Driver ${req.user.name || 'someone'} finalized a delivery. Escrow payouts triggered.`
//       });
//     }

//     res.json({ message: 'Delivery marked as complete' });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: 'Server Error' });
//   }
// };

// // @desc    Get delivery history
// // @route   GET /api/delivery/history
// // @access  Private (Delivery)
// const getDeliveryHistory = async (req, res) => {
//   try {
//     const deliveries = await Delivery.find({ deliveryAgent: req.user.id, status: 'delivered' });
//     res.json(deliveries);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: 'Server Error' });
//   }
// };

// module.exports = {
//   getAssignedDeliveries,
//   markDelivered,
//   getDeliveryHistory
// };











// controllers/deliveryController.js
const Delivery = require("../models/Delivery");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const escrowService = require("../services/escrowService");

// ✅ SMS (exactly as you defined it in services/sms.js). Optional import (won't break if missing)
let sendText = null;
try {
  ({ sendText } = require("../services/sms"));
} catch (_) {
  // SMS service not installed / disabled
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function fmtMoneyKes(amount) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "KES" }).format(n);
  } catch {
    return `KES ${n.toFixed(2)}`;
  }
}

// @desc    Get assigned deliveries
// @route   GET /api/delivery/assigned
// @access  Private (Delivery)
const getAssignedDeliveries = async (req, res) => {
  try {
    const DeliveryPersonnel = require("../models/DeliveryPersonnel");
    const Student = require("../models/Student");

    const driver = await DeliveryPersonnel.findOne({ user: req.user.id });
    const assignedLocationIds = driver ? driver.assignedLocations || [] : [];

    const deliveries = await Delivery.find({
      $or: [
        { deliveryAgent: req.user.id },
        { 
          deliveryLocation: { $in: assignedLocationIds },
          $or: [
            { deliveryAgent: null },
            { deliveryAgent: { $exists: false } }
          ]
        }
      ],
      status: { $nin: ["delivered", "cancelled", "failed"] }
    })
      .populate("student", "name email phone")
      .populate("deliveryLocation")
      .populate({
        path: "vendor",
        populate: { path: "user", select: "name email phone" },
      })
      .sort({ scheduledDate: -1, createdAt: -1 })
      .lean();

    // ✅ Enrich each delivery with the Student profile (hostel, block, floor, room, landmark, instructions)
    const studentUserIds = deliveries
      .map((d) => d.student?._id || d.student)
      .filter(Boolean);

    const studentProfiles = await Student.find({ user: { $in: studentUserIds } })
      .select("user hostel block floor room landmark instructions diet allergies")
      .lean();

    const profileByUserId = {};
    for (const sp of studentProfiles) {
      profileByUserId[String(sp.user)] = sp;
    }

    const enriched = deliveries.map((d) => {
      const userId = String(d.student?._id || d.student || "");
      const sp = profileByUserId[userId] || {};
      return {
        ...d,
        student: {
          ...(d.student || {}),
          hostel: sp.hostel || "",
          block: sp.block || "",
          floor: sp.floor || "",
          room: sp.room || "",
          landmark: sp.landmark || "",
          instructions: sp.instructions || "",
          diet: sp.diet || "",
          allergies: sp.allergies || "",
        },
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Confirm food pickup (assigned → picked_up)
// @route   PUT /api/delivery/pickup/:id
// @access  Private (Delivery)
const confirmPickup = async (req, res) => {
  try {
    const DeliveryPersonnel = require("../models/DeliveryPersonnel");
    const driver = await DeliveryPersonnel.findOne({ user: req.user.id });
    const assignedLocationIds = driver ? driver.assignedLocations || [] : [];

    const delivery = await Delivery.findOne({
      _id: req.params.id,
      $or: [
        { deliveryAgent: req.user.id },
        { deliveryLocation: { $in: assignedLocationIds } }
      ]
    });

    if (!delivery) return res.status(404).json({ message: "Delivery not found or not assigned to you." });
    if (delivery.deliveryAgent && String(delivery.deliveryAgent) !== String(req.user.id)) {
      return res.status(400).json({ message: "This delivery is already assigned to another driver." });
    }
    if (delivery.status === "delivered") return res.status(400).json({ message: "Order already delivered." });
    if (delivery.status === "picked_up") return res.status(400).json({ message: "Order already marked as picked up." });

    delivery.status = "picked_up";
    delivery.deliveryAgent = req.user.id; // Ensure agent is set
    await delivery.save();

    // Notify vendor
    const Notification = require("../models/Notification");
    if (delivery.vendor) {
      await Notification.create({
        user: delivery.vendor,
        type: "alert",
        title: "Order Picked Up 🚴",
        message: `Driver ${req.user.name || "Driver"} has picked up order #${String(delivery._id).slice(-6)}. Food is now in transit.`
      });
    }

    res.json({ message: "Pickup confirmed. Order is now in transit.", status: delivery.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Mark delivery as complete
// @route   POST /api/delivery/complete
// @access  Private (Delivery)
const markDelivered = async (req, res) => {
  const { deliveryId, code } = req.body;

  try {
    const DeliveryPersonnel = require("../models/DeliveryPersonnel");
    const driver = await DeliveryPersonnel.findOne({ user: req.user.id });
    const assignedLocationIds = driver ? driver.assignedLocations || [] : [];

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      $or: [
        { deliveryAgent: req.user.id },
        { deliveryLocation: { $in: assignedLocationIds } }
      ]
    })
      .populate("student", "name email phone")
      .populate({
        path: "vendor",
        populate: { path: "user", select: "name email phone" },
      });

    if (!delivery) return res.status(404).json({ message: "Delivery not found" });
    if (delivery.deliveryAgent && String(delivery.deliveryAgent) !== String(req.user.id)) {
      return res.status(400).json({ message: "This delivery is already assigned to another driver." });
    }

    if (delivery.status === "delivered") {
      return res.status(400).json({ message: "Order is already delivered." });
    }

    if (!delivery.deliveryVerificationCode) {
      return res.status(400).json({ message: "No delivery verification code exists for this order." });
    }

    let providedCode = String(code || "").trim().toUpperCase();
    if (!providedCode.startsWith("NP-")) {
      providedCode = "NP-" + providedCode;
    }

    const cleanProvided = providedCode.replace(/[^A-Z0-9]/g, "");
    const cleanActual = String(delivery.deliveryVerificationCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (cleanProvided !== cleanActual) {
      return res.status(400).json({ message: "Invalid delivery verification code. Access Denied." });
    }

    if (delivery.deliveryVerificationExpiry && new Date() > new Date(delivery.deliveryVerificationExpiry)) {
      return res.status(400).json({ message: "Delivery verification code has expired." });
    }

    // Link the completing driver
    delivery.deliveryAgent = req.user.id;

    const wasAlreadyDelivered = false;

    // ===== New hybrid custodial payout logic =====
    if (!wasAlreadyDelivered) {
      try {
        await escrowService.releaseDailyVendorPayment(deliveryId);
      } catch (payoutError) {
        console.error("Payout failed during delivery completion:", payoutError);
        return res.status(500).json({
          message:
            "Delivery marked but payout failed: " +
            (payoutError.message || "Unknown error"),
        });
      }
    }

    delivery.status = "delivered";
    delivery.deliveredAt = Date.now();
    await delivery.save();

    // ===== Auto-complete active subscription if all deliveries are fulfilled =====
    const studentId = delivery.student?._id || delivery.student;
    if (studentId) {
      const subscriptionService = require("../services/subscriptionService");
      await subscriptionService.checkAndAutoCompleteSubscriptions(studentId);
    }

    // ===== Existing notification logic (unchanged) =====
    const Notification = require("../models/Notification");
    if (delivery.vendor && delivery.vendor.user) {
      const vendorUserId =
        delivery?.vendor?.user?._id || delivery?.vendor?.user;

      await Notification.create({
        user: vendorUserId,
        type: "alert",
        title: "Delivery Completed",
        message: `Driver ${req.user.name || "someone"} finalized a delivery. Escrow payouts triggered.`,
      });
    }

    // ✅ SMS on successful delivery (only on transition to delivered)
    if (!wasAlreadyDelivered && typeof sendText === "function") {
      const studentPhone = safeStr(delivery?.student?.phone);
      const vendorPhone = safeStr(delivery?.vendor?.user?.phone);

      const dateLabel = delivery?.scheduledDate
        ? new Date(delivery.scheduledDate).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : "";

      const timeSlot = safeStr(delivery?.timeSlot || "");
      const amount = fmtMoneyKes(delivery?.totalCost);
      const driverName = safeStr(req.user?.name || "Driver");

      // Student SMS
      if (studentPhone) {
        const orderIdStr = delivery?.orderId || (delivery?._id ? delivery._id.toString().slice(-8).toUpperCase() : '');
        const msgStudent =
          `NutriPay: Your order ${orderIdStr ? '#' + orderIdStr + ' ' : ''}is delivered.\n` +
          `Meal: ${dateLabel}${timeSlot ? " • " + timeSlot : ""}\n` +
          `Amount: ${amount}\n` +
          `Delivered by: ${driverName}`;

        try {
          await sendText(studentPhone, msgStudent);
        } catch (e) {
          console.warn("Student SMS error (ignored):", e.message);
        }
      }

      // Vendor SMS (optional)
      if (vendorPhone) {
        const studentName = safeStr(delivery?.student?.name) || "Student";
        const msgVendor =
          `NutriPay: Delivery completed\n` +
          `Student: ${studentName}\n` +
          `Meal: ${dateLabel}${timeSlot ? " • " + timeSlot : ""}\n` +
          `Amount: ${amount}`;

        try {
          await sendText(vendorPhone, msgVendor);
        } catch (e) {
          console.warn("Vendor SMS error (ignored):", e.message);
        }
      }
    }

    res.json({ message: "Delivery marked as complete" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Get delivery history
// @route   GET /api/delivery/history
// @access  Private (Delivery)
const getDeliveryHistory = async (req, res) => {
  try {
    const deliveries = await Delivery.find({
      deliveryAgent: req.user.id,
      status: "delivered",
    })
      .populate("student", "name email phone")
      .populate("deliveryLocation")
      .sort({ deliveredAt: -1, createdAt: -1 })
      .lean();

    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  getAssignedDeliveries,
  confirmPickup,
  markDelivered,
  getDeliveryHistory,
};