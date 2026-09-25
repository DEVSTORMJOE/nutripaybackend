const mongoose = require("mongoose");

const loyaltyLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckoutRequest",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["earned", "converted_to_wallet", "expired", "adjusted"],
      required: true,
    },
    points: {
      type: Number,
      required: true,
    },
    orderAmountKES: {
      type: Number,
      default: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    stellarTxHash: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

const LoyaltyLog =
  mongoose.models.LoyaltyLog || mongoose.model("LoyaltyLog", loyaltyLogSchema);

module.exports = LoyaltyLog;
