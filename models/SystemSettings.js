const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    default: ''
  }
}, { timestamps: true });

// Static helper to get setting with default fallback
systemSettingsSchema.statics.getSetting = async function(key, defaultValue) {
  const doc = await this.findOne({ key });
  if (!doc) return defaultValue;
  return doc.value;
};

// Static helper to set/update setting
systemSettingsSchema.statics.setSetting = async function(key, value, description = '') {
  return await this.findOneAndUpdate(
    { key },
    { value, description },
    { upsert: true, new: true }
  );
};

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);
module.exports = SystemSettings;
