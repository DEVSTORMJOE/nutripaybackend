// models/DeliveryPersonnel.js
const mongoose = require("mongoose");

const deliveryPersonnelSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    assignedLocations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryLocation",
      }
    ],

    serviceArea: {
      type: String,
      trim: true,
      default: "",
    },

    transportMode: {
      type: String,
      trim: true,
      default: "",
    },

    availability: {
      type: String,
      trim: true,
      default: "",
    },

    emergencyContact: {
      type: String,
      trim: true,
      default: "",
    },

    approvedStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    assignmentType: {
      type: String,
      enum: ["meal_delivery", "ndash", "both"],
      default: "meal_delivery",
    },
  },
  { timestamps: true }
);

const DeliveryPersonnel = mongoose.model(
  "DeliveryPersonnel",
  deliveryPersonnelSchema
);

module.exports = DeliveryPersonnel;