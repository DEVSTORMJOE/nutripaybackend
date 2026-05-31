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
    type: Number,
    required: true
  },
  newVendorPercent: {
    type: Number,
    required: true
  },
  oldPlatformPercent: {
    type: Number,
    required: true
  },
  newPlatformPercent: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    default: ''
  }
}, { timestamps: true });

const CommissionAudit = mongoose.models.CommissionAudit || mongoose.model('CommissionAudit', commissionAuditSchema);
module.exports = CommissionAudit;
