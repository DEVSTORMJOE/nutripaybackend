const mongoose = require('mongoose');

const commissionAuditSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  oldVendorPercent: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  newVendorPercent: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  oldPlatformPercent: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  newPlatformPercent: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  reason: {
    type: String,
    default: ''
  }
}, { timestamps: true });

const CommissionAudit = mongoose.models.CommissionAudit || mongoose.model('CommissionAudit', commissionAuditSchema);
module.exports = CommissionAudit;
