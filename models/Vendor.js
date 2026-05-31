// const mongoose = require('mongoose');

// const vendorSchema = new mongoose.Schema({
//   user: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   stellarPublicKey: {
//     type: String,
//     required: true
//   },
//   approvedStatus: {
//     type: String,
//     enum: ['pending', 'approved', 'rejected'],
//     default: 'pending'
//   },
//   meals: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Meal'
//   }],
//   deliveryStaff: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   }],
//   locations: [{
//     name: String,
//     address: String,
//     hours: String,
//     status: { type: String, enum: ['Open', 'Closed'], default: 'Open' }
//   }]
// }, { timestamps: true });

// const Vendor = mongoose.model('Vendor', vendorSchema);
// module.exports = Vendor;




// models/Vendor.js
const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    stellarPublicKey: {
      type: String,
      default: "",
    },

    businessName: {
      type: String,
      trim: true,
      default: "",
    },

    businessPhone: {
      type: String,
      trim: true,
      default: "",
    },

    businessEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    cuisine: {
      type: String,
      trim: true,
      default: "",
    },

    approvedStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    meals: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Meal",
      },
    ],

    deliveryStaff: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    locations: [
      {
        name: {
          type: String,
          trim: true,
          default: "",
        },
        address: {
          type: String,
          trim: true,
          default: "",
        },
        hours: {
          type: String,
          trim: true,
          default: "",
        },
        status: {
          type: String,
          enum: ["Open", "Closed"],
          default: "Open",
        },
      },
    ],
    vendorCommissionPercent: {
      type: Number,
      default: 90,
    },
    platformCommissionPercent: {
      type: Number,
      default: 10,
    },
  },
  { timestamps: true }
);

const Vendor = mongoose.model("Vendor", vendorSchema);

module.exports = Vendor;