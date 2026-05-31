const mongoose = require("mongoose");

const MealSnapshotSchema = new mongoose.Schema(
  {
    mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal" },
    name: { type: String, required: true },
    category: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    nutrition: { type: Object, default: {} },
  },
  { _id: false }
);

const TemplateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // uuid from client
    label: { type: String, default: "Balanced Plan" },
    qty: { type: Number, default: 1, min: 1 },
    main: { type: MealSnapshotSchema, required: false },
    drink: { type: MealSnapshotSchema, required: false },
    fruit: { type: MealSnapshotSchema, required: false },
    timeSlot: { type: String, default: "Lunch" },
    isMonthlyPlan: { type: Boolean, default: false },
    billingCycle: { type: String, default: "daily" },
    planId: { type: String, default: "" },
    customSchedule: { type: Array, default: undefined },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DayPlanSchema = new mongoose.Schema(
  {
    label: { type: String, default: "Plan" },
    qty: { type: Number, default: 1, min: 1 },
    main: { type: MealSnapshotSchema, required: false },
    drink: { type: MealSnapshotSchema, required: false },
    fruit: { type: MealSnapshotSchema, required: false },
    timeSlot: { type: String, default: "Lunch" },
    templateId: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
    currency: { type: String, default: "KES" },

    templates: { type: [TemplateSchema], default: [] },

    // Stored as object map: { "YYYY-MM-DD": DayPlan }
    schedule: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Cart", CartSchema);