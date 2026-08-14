const mongoose = require("mongoose");

const ambassadorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    campus: {
      type: String,
      trim: true,
      default: "Main Campus",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    totalReferrals: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const Ambassador =
  mongoose.models.Ambassador || mongoose.model("Ambassador", ambassadorSchema);

module.exports = Ambassador;
