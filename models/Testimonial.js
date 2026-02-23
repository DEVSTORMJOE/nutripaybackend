// server/models/Testimonial.js
const mongoose = require("mongoose");

const TestimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    location: { type: String, required: true, trim: true, maxlength: 140 },
    imageUrl: { type: String, default: "" },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    active: { type: Boolean, default: false }, // public submissions inactive until admin approves
  },
  { timestamps: true }
);

module.exports = mongoose.model("Testimonial", TestimonialSchema);