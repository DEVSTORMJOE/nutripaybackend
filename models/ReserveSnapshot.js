const mongoose = require('mongoose');

const reserveSnapshotSchema = new mongoose.Schema({
  treasuryNT: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  escrowNT: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  vendorSettlementNT: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  revenueNT: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  mongodbAvailableKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  mongodbLockedKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  mongodbVendorSettlementKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  mongodbRevenueKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  discrepancyTreasury: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  discrepancyEscrow: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  discrepancyVendor: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  discrepancyRevenue: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  auditReserveNT: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  mongodbAuditReserveKES: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  discrepancyAuditReserve: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  feeReserveXLM: {
    type: mongoose.Schema.Types.Decimal128,
    default: "0.00"
  },
  status: {
    type: String,
    enum: ['match', 'discrepancy'],
    default: 'match'
  }
}, { timestamps: true });

const ReserveSnapshot = mongoose.models.ReserveSnapshot || mongoose.model('ReserveSnapshot', reserveSnapshotSchema);
module.exports = ReserveSnapshot;
