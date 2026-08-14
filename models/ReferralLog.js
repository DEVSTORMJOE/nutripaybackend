const mongoose = require("mongoose");

const referralLogSchema = new mongoose.Schema(
  {
    ambassadorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ambassador",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    verificationCode: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const ReferralLog =
  mongoose.models.ReferralLog || mongoose.model("ReferralLog", referralLogSchema);

module.exports = ReferralLog;
