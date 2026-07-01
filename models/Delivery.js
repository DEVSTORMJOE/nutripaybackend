const mongoose = require('mongoose');
const DeliveryPersonnel = require('./DeliveryPersonnel');

const deliverySchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  sponsor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deliveryAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  items: [{
    name: String,
    quantity: Number
  }],
  status: {
    type: String,
    enum: ['awaiting_sponsor', 'pending', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled', 'donated'],
    default: 'pending'
  },
  totalCost: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: "0.00"
  },
  paymentReleased: {
    type: Boolean,
    default: false
  },
  timeSlot: {
    type: String,
    enum: ['Breakfast', 'Lunch', 'Supper'],
    default: 'Lunch'
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  deliveredAt: Date,
  deliveryVerificationCode: {
    type: String,
    sparse: true
  },
  deliveryVerificationExpiry: Date,
  location: String,
  deliveryLocation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryLocation',
    default: null
  },
  originalStudent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isDonated: {
    type: Boolean,
    default: false
  },
  isCustom: {
    type: Boolean,
    default: false
  },
  claimedAt: Date
}, { timestamps: true });

deliverySchema.pre('save', async function (next) {
  if (!this.deliveryLocation && this.location && this.location !== 'Campus') {
    try {
      const DeliveryLocation = mongoose.model('DeliveryLocation');
      // Try exact match first
      let dl = await DeliveryLocation.findOne({
        hostelResidence: new RegExp('^' + this.location.trim() + '$', 'i')
      });
      // Fallback: partial match (hostel name contains the location string or vice versa)
      if (!dl) {
        const firstWord = this.location.trim().split(/\s+/)[0];
        dl = await DeliveryLocation.findOne({
          hostelResidence: new RegExp(firstWord, 'i')
        });
      }
      if (dl) {
        this.deliveryLocation = dl._id;
      }
    } catch (err) {
      console.error("Resolving delivery location failed:", err);
    }
  }
  next();
});

const Delivery = mongoose.model('Delivery', deliverySchema);
module.exports = Delivery;
