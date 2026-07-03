const mongoose = require('mongoose');

const auditCaseSchema = new mongoose.Schema({
  caseId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  status: {
    type: String,
    enum: ['Open', 'Investigating', 'Resolved', 'Escalated'],
    default: 'Open'
  },
  detectedRules: {
    type: [String],
    default: []
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    default: null
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    default: null
  },
  withdrawal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WithdrawalRequest',
    default: null
  },
  refund: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RefundRequest',
    default: null
  },
  evidence: {
    type: [String],
    default: []
  },
  notes: [{
    actor: { type: String, required: true },
    note: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  isolatedAmountKES: {
    type: Number,
    default: 0
  },
  isolatedSource: {
    type: String,
    enum: ['treasury', 'escrow', 'vendorSettlement', 'revenue', null],
    default: null
  },
  auditTrail: [{
    action: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

auditCaseSchema.pre('save', function (next) {
  if (this.isNew) {
    this._isNewDoc = true;
  }
  next();
});

auditCaseSchema.post('save', async function (doc) {
  if (doc._isNewDoc) {
    try {
      const User = mongoose.model('User');
      const Notification = mongoose.model('Notification');
      
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await Notification.create({
          user: admin._id,
          type: 'alert',
          title: `⚠️ New Audit Case: ${doc.title}`,
          message: `Case ID: ${doc.caseId}. ${doc.description || 'A compliance event was recorded. Please check it in the Audit Center.'}`
        });
      }
      console.log(`[AuditCase Hook] Dispatched admin notifications for case: ${doc.caseId}`);
    } catch (err) {
      console.error("Failed to dispatch AuditCase notifications:", err.message);
    }
  }
});

const AuditCase = mongoose.models.AuditCase || mongoose.model('AuditCase', auditCaseSchema);
module.exports = AuditCase;
