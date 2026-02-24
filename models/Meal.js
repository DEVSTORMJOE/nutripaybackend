const mongoose = require("mongoose");

const NutritionSchema = new mongoose.Schema(
  {
    calories: { type: Number, default: 0 },
    protein_g: { type: Number, default: 0 },
    carbs_g: { type: Number, default: 0 },
    fat_g: { type: Number, default: 0 },
    fiber_g: { type: Number, default: 0 },
    sugar_g: { type: Number, default: 0 },
    sodium_mg: { type: Number, default: 0 },
  },
  { _id: false }
);

const MealSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, enum: ["main", "drink", "fruit"] },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES" },
    nutrition: { type: NutritionSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meal", MealSchema);