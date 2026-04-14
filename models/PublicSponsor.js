const mongoose = require('mongoose');

const publicSponsorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  logoUrl: { type: String, required: true },
  href: { type: String, default: "" },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('PublicSponsor', publicSponsorSchema);
