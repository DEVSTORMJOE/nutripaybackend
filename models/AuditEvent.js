const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema({
  actor: {
    type: String,
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  ip: {
    type: String,
    default: '127.0.0.1'
  },
  entity: {
    type: String,
    index: true
  },
  referenceIds: {
    type: [String],
    default: [],
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Enforce strictly immutable logs (append-only)
const preventDeleteOrUpdate = function(next) {
  next(new Error("Audit events are immutable and cannot be updated or deleted."));
};

auditEventSchema.pre('remove', preventDeleteOrUpdate);
auditEventSchema.pre('deleteOne', preventDeleteOrUpdate);
auditEventSchema.pre('deleteMany', preventDeleteOrUpdate);
auditEventSchema.pre('findOneAndDelete', preventDeleteOrUpdate);
auditEventSchema.pre('findByIdAndDelete', preventDeleteOrUpdate);
auditEventSchema.pre('updateOne', preventDeleteOrUpdate);
auditEventSchema.pre('updateMany', preventDeleteOrUpdate);
auditEventSchema.pre('findOneAndUpdate', preventDeleteOrUpdate);

auditEventSchema.pre('save', function(next) {
  if (!this.isNew) {
    return next(new Error("Audit events are immutable and cannot be edited."));
  }
  next();
});

const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
module.exports = AuditEvent;
