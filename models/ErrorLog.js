const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  level: {
    type: String,
    enum: ['info', 'warn', 'error', 'fatal'],
    default: 'error',
    required: true
  },
  category: {
    type: String,
    enum: ['wallet', 'auth', 'mpesa', 'database', 'escrow', 'general'],
    default: 'general',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  resolved: {
    type: Boolean,
    default: false,
    required: true
  },
  resolvedAt: Date,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Indexing for faster admin queries
errorLogSchema.index({ timestamp: -1 });
errorLogSchema.index({ resolved: 1 });
errorLogSchema.index({ category: 1 });

const ErrorLog = mongoose.models.ErrorLog || mongoose.model('ErrorLog', errorLogSchema);
module.exports = ErrorLog;
