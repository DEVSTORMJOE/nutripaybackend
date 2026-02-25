const Transaction = require('../models/Transaction');
const Delivery = require('../models/Delivery');
const Wallet = require('../models/Wallet');
const Vendor = require('../models/Vendor');

// @desc    Get notifications for logged in user
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find user's wallet
    const wallet = await Wallet.findOne({ user: userId });

    const notifications = [];

    // Recent transactions involving the user's wallet
    if (wallet) {
      const txs = await Transaction.find({ $or: [{ fromWallet: wallet._id }, { toWallet: wallet._id }] })
        .sort({ createdAt: -1 })
        .limit(10);

      txs.forEach(tx => {
        notifications.push({
          type: 'transaction',
          title: `Transaction ${tx.type}`,
          message: `${tx.amount} XLM - ${tx.description || ''}`,
          time: tx.createdAt,
          meta: tx
        });
      });
    }

    // Recent delivery updates if student, delivery agent or vendor
    const vendorRecord = await Vendor.findOne({ user: userId });
    const deliveriesQuery = [{ student: userId }, { deliveryAgent: userId }];
    if (vendorRecord) {
      deliveriesQuery.push({ vendor: vendorRecord._id });
    }

    const deliveries = await Delivery.find({ $or: deliveriesQuery })
      .sort({ scheduledDate: -1 })
      .limit(10);

    deliveries.forEach(d => {
      notifications.push({
        type: 'delivery',
        title: `Delivery ${d.status}`,
        message: `${d.items && d.items.length ? d.items.map(i => i.name).join(', ') : 'Meal delivery'}`,
        time: d.scheduledDate,
        meta: d
      });
    });

    // Sort by time desc and return
    notifications.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json(notifications.slice(0, 20));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getNotifications };
