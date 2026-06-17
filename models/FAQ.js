// server/models/FAQ.js
const mongoose = require("mongoose");

const FAQSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, unique: true },
    answer: { type: String, required: true, trim: true },
    category: { type: String, default: "general", trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FAQ", FAQSchema);
