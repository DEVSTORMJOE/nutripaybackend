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
    type: Number,
    required: true,
    default: 0
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
  claimedAt: Date
}, { timestamps: true });

deliverySchema.pre('save', async function (next) {
  if (this.status === 'pending' && !this.deliveryAgent) {
    try {
      const DeliveryPersonnel = mongoose.model('DeliveryPersonnel');
      let locId = this.deliveryLocation;
      
      // If deliveryLocation is not set but location (hostel name) is set, find the delivery location document
      if (!locId && this.location) {
        const DeliveryLocation = mongoose.model('DeliveryLocation');
        const dl = await DeliveryLocation.findOne({
          hostelResidence: new RegExp('^' + this.location.trim() + '$', 'i')
        });
        if (dl) {
          locId = dl._id;
          this.deliveryLocation = dl._id;
        }
      }
      
      if (locId) {
        // Find approved delivery personnel assigned to this location
        const assignedStaff = await DeliveryPersonnel.findOne({
          assignedLocations: locId,
          approvedStatus: 'approved'
        });
        if (assignedStaff) {
          this.deliveryAgent = assignedStaff.user;
          this.status = 'assigned';
        }
      }
    } catch (err) {
      console.error("Auto routing delivery assignment failed:", err);
    }
  }
  next();
});

const Delivery = mongoose.model('Delivery', deliverySchema);
module.exports = Delivery;
