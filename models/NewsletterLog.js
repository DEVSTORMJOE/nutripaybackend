// server/models/NewsletterLog.js
const mongoose = require("mongoose");

const NewsletterLogSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    html: { type: String, default: "" },
    text: { type: String, default: "" },
    includeAll: { type: Boolean, default: false },
    ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    recipientCount: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.NewsletterLog ||
  mongoose.model("NewsletterLog", NewsletterLogSchema);