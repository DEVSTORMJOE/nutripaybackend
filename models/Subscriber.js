// server/models/Subscriber.js
const mongoose = require("mongoose");

const SubscriberSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    phone: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["subscribed", "unsubscribed"],
      default: "subscribed",
      index: true,
    },
    source: { type: String, default: "website" },
    meta: { type: Object, default: {} },
    unsubscribedAt: { type: Date },
  },
  { timestamps: true }
);

SubscriberSchema.pre("validate", function (next) {
  if (this.email) this.email = String(this.email).trim().toLowerCase();
  next();
});

module.exports =
  mongoose.models.Subscriber ||
  mongoose.model("Subscriber", SubscriberSchema);