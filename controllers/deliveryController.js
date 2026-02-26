const Delivery = require('../models/Delivery');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarService = require('../services/stellarService');

// @desc    Get assigned deliveries
// @route   GET /api/delivery/assigned
// @access  Private (Delivery)
const getAssignedDeliveries = async (req, res) => {
  try {
    const deliveries = await Delivery.find({ deliveryAgent: req.user.id, status: { $ne: 'delivered' } })
      .populate('student', 'name email')
      .populate({
        path: 'vendor',
        populate: { path: 'user', select: 'name email' }
      });
    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Mark delivery as complete
// @route   POST /api/delivery/complete
// @access  Private (Delivery)
const markDelivered = async (req, res) => {
  const { deliveryId } = req.body;

  try {
    const delivery = await Delivery.findOne({ _id: deliveryId, deliveryAgent: req.user.id }).populate('vendor');
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

    if (delivery.status !== 'delivered') {
      const payoutKes = Number(delivery.totalCost || 0);

      if (payoutKes > 0) {
        // Find Admin Escrow Wallet and Vendor Wallet
        const adminWallet = await Wallet.findOne({ walletType: 'admin' }).select('+stellarSecretKey');
        const vendorWallet = await Wallet.findOne({ user: delivery.vendor.user }); // vendor.user is the User ObjectId

        if (adminWallet && adminWallet.stellarSecretKey && vendorWallet) {
          try {
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
          } catch (payoutError) {
            console.error("Payout failed during delivery completion:", payoutError);
            return res.status(500).json({ message: 'Delivery marked but payout failed: ' + (payoutError.message || 'Unknown error') });
          }
        } else {
            console.warn("Wallet information missing. Cannot process vendor payout.");
        }
      }
    }

    delivery.status = 'delivered';
    delivery.deliveredAt = Date.now();
    await delivery.save();

    const Notification = require('../models/Notification');
    if (delivery.vendor && delivery.vendor.user) {
      await Notification.create({
        user: delivery.vendor.user,
        type: 'alert',
        title: 'Delivery Completed',
        message: `Driver ${req.user.name || 'someone'} finalized a delivery. Escrow payouts triggered.`
      });
    }

    res.json({ message: 'Delivery marked as complete' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get delivery history
// @route   GET /api/delivery/history
// @access  Private (Delivery)
const getDeliveryHistory = async (req, res) => {
  try {
    const deliveries = await Delivery.find({ deliveryAgent: req.user.id, status: 'delivered' });
    res.json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  getAssignedDeliveries,
  markDelivered,
  getDeliveryHistory
};
