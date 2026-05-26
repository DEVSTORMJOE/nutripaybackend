const mongoose = require('mongoose');

const reserveSnapshotSchema = new mongoose.Schema({
  treasuryNT: {
    type: Number,
    required: true
  },
  escrowNT: {
    type: Number,
    required: true
  },
  vendorSettlementNT: {
    type: Number,
    required: true
  },
  revenueNT: {
    type: Number,
    required: true
  },
  mongodbAvailableKES: {
    type: Number,
    required: true
  },
  mongodbLockedKES: {
    type: Number,
    required: true
  },
  mongodbVendorSettlementKES: {
    type: Number,
    required: true
  },
  mongodbRevenueKES: {
    type: Number,
    required: true
  },
  discrepancyTreasury: {
    type: Number,
    default: 0
  },
  discrepancyEscrow: {
    type: Number,
    default: 0
  },
  discrepancyVendor: {
    type: Number,
    default: 0
  },
  discrepancyRevenue: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['match', 'discrepancy'],
    default: 'match'
  }
}, { timestamps: true });

const ReserveSnapshot = mongoose.models.ReserveSnapshot || mongoose.model('ReserveSnapshot', reserveSnapshotSchema);
module.exports = ReserveSnapshot;
