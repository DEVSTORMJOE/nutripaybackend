// backend/models/Sponsor.js
const mongoose = require("mongoose");

const SponsorSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 60 },
    logoUrl: { type: String, trim: true, required: true }, // SVG URL or image URL
    href: { type: String, trim: true, default: "" },

    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

SponsorSchema.index({ isActive: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("Sponsor", SponsorSchema);
