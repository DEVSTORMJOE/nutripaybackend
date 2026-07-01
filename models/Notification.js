const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['order', 'alert', 'system', 'sponsorship', 'activity', 'wallet', 'delivery'], default: 'system' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

notificationSchema.post('save', function(doc) {
  const { dispatchNotification } = require('../utils/notificationDispatcher');
  dispatchNotification(doc).catch(err => console.error('Failed to dispatch notification:', err));
});

module.exports = mongoose.model('Notification', notificationSchema);
