const Delivery = require('../models/Delivery');

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
    const delivery = await Delivery.findOne({ _id: deliveryId, deliveryAgent: req.user.id });
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

    delivery.status = 'delivered';
    delivery.deliveredAt = Date.now();
    await delivery.save();

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
