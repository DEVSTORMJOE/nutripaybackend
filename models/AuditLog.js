const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'withdrawal_approval',
      'commission_change',
      'refund_approval',
      'manual_adjustment',
      'sponsor_funding'
    ],
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, { timestamps: true });

// Prevent deleting audit logs by throwing error on delete middleware
const preventDelete = function(next) {
  next(new Error("Audit logs are permanent and cannot be deleted."));
};

auditLogSchema.pre('remove', preventDelete);
auditLogSchema.pre('deleteOne', preventDelete);
auditLogSchema.pre('deleteMany', preventDelete);
auditLogSchema.pre('findOneAndDelete', preventDelete);
auditLogSchema.pre('findByIdAndDelete', preventDelete);

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
module.exports = AuditLog;
