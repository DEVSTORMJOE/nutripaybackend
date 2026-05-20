// models/DeliveryLocation.js
const mongoose = require("mongoose");

const deliveryLocationSchema = new mongoose.Schema(
  {
    university: {
      type: String,
      trim: true,
      default: "Egerton University",
    },

    campus: {
      type: String,
      trim: true,
      default: "Njoro Main Campus",
    },

    hostelResidence: {
      type: String,
      required: true,
      trim: true,
    },

    block: {
      type: String,
      required: true,
      trim: true,
    },

    room: {
      type: String,
      required: true,
      trim: true,
    },

    landmark: {
      type: String,
      required: true,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

deliveryLocationSchema.index({
  university: "text",
  campus: "text",
  hostelResidence: "text",
  block: "text",
  room: "text",
  landmark: "text",
});

const DeliveryLocation =
  mongoose.models.DeliveryLocation ||
  mongoose.model("DeliveryLocation", deliveryLocationSchema);

module.exports = DeliveryLocation;