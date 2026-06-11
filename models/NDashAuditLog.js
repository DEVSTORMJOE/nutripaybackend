const mongoose = require('mongoose');

const nDashAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  ndashOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NDashOrder'
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  }
}, { timestamps: true });

const NDashAuditLog = mongoose.models.NDashAuditLog || mongoose.model('NDashAuditLog', nDashAuditLogSchema);
module.exports = NDashAuditLog;
