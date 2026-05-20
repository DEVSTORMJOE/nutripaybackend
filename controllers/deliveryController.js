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
const stellarService = require("../services/stellarService");

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
    const deliveries = await Delivery.find({
      deliveryAgent: req.user.id,
      status: { $ne: "delivered" },
    })
      // ✅ include phone so SMS routing can work (non-breaking)
      .populate("student", "name email phone")
      .populate({
        path: "vendor",
        populate: { path: "user", select: "name email phone" },
      });

    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Mark delivery as complete
// @route   POST /api/delivery/complete
// @access  Private (Delivery)
const markDelivered = async (req, res) => {
  const { deliveryId } = req.body;

  try {
    // ✅ keep logic, just populate student/vendor.user for SMS
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      deliveryAgent: req.user.id,
    })
      .populate("student", "name email phone")
      .populate({
        path: "vendor",
        populate: { path: "user", select: "name email phone" },
      });

    if (!delivery) return res.status(404).json({ message: "Delivery not found" });

    const wasAlreadyDelivered = delivery.status === "delivered";

    // ===== Existing payout logic (unchanged) =====
    if (!wasAlreadyDelivered) {
      const payoutKes = Number(delivery.totalCost || 0);

      if (payoutKes > 0) {
        // Find Admin Escrow Wallet and Vendor Wallet
        const adminWallet = await Wallet.findOne({ walletType: "admin" }).select(
          "+stellarSecretKey",
        );

        const vendorUserId =
          delivery?.vendor?.user?._id || delivery?.vendor?.user; // supports populated or raw ObjectId
        const vendorWallet = await Wallet.findOne({ user: vendorUserId }); // vendor.user is the User ObjectId

        if (adminWallet && adminWallet.stellarSecretKey && vendorWallet) {
          try {
            // Payout from Admin to Vendor
            const tx = await stellarService.makePayment(
              adminWallet.stellarSecretKey,
              vendorWallet.stellarPublicKey,
              payoutKes,
            );

            // Log Payout Transaction
            await Transaction.create({
              fromWallet: adminWallet._id,
              toWallet: vendorWallet._id,
              amount: payoutKes,
              type: "payout",
              stellarTxHash: tx.hash,
              description: `Payout for completed delivery ${delivery._id}`,
              status: "completed",
            });

            // Update local balances
            adminWallet.balance -= payoutKes;
            await adminWallet.save();

            vendorWallet.balance += payoutKes;
            await vendorWallet.save();
          } catch (payoutError) {
            console.error("Payout failed during delivery completion:", payoutError);
            return res.status(500).json({
              message:
                "Delivery marked but payout failed: " +
                (payoutError.message || "Unknown error"),
            });
          }
        } else {
          console.warn("Wallet information missing. Cannot process vendor payout.");
        }
      }
    }

    // ===== Existing delivery completion logic (unchanged) =====
    delivery.status = "delivered";
    delivery.deliveredAt = Date.now();
    await delivery.save();

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
        const msgStudent =
          `NutriPay: Delivered ✅\n` +
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
          `NutriPay: Delivery completed ✅\n` +
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
    });

    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  getAssignedDeliveries,
  markDelivered,
  getDeliveryHistory,
};