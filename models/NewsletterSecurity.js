// server/models/NewsletterSecurity.js
const mongoose = require("mongoose");

const NewsletterSecuritySchema = new mongoose.Schema(
  {
    hash: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.NewsletterSecurity ||
  mongoose.model("NewsletterSecurity", NewsletterSecuritySchema);