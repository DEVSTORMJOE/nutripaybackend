const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const DeliveryLocation = require("../models/DeliveryLocation");
const Student = require("../models/Student");
const Meal = require("../models/Meal");
const WeeklyPlan = require("../models/WeeklyPlan");

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/nutripay");
    console.log("Connected to MongoDB.");

    // Find student
    const studentUser = await User.findOne({ role: "student" });
    if (!studentUser) {
      console.error("No student user found.");
      process.exit(1);
    }
    console.log("Found Student User:", studentUser.email);

    // Clean up existing subscriptions for this student to allow checkout
    const SubscriptionModel = require('../models/Subscription');
    await SubscriptionModel.deleteMany({ student: studentUser._id });
    const DeliveryModel = require('../models/Delivery');
    await DeliveryModel.deleteMany({ student: studentUser._id });
    console.log("Cleared existing subscriptions and deliveries for student.");

    // Ensure student wallet has enough balance for checkout
    const WalletModel = require('../models/Wallet');
    let wallet = await WalletModel.findOne({ user: studentUser._id });
    if (!wallet) {
      wallet = await WalletModel.create({
        user: studentUser._id,
        availableBalanceKES: 10000,
        role: 'student',
        status: 'active',
        walletFundingSources: [{
          sourceType: 'self',
          amountKES: 10000,
          restrictedUsage: false,
          restrictedUsageType: 'none'
        }]
      });
    } else {
      wallet.availableBalanceKES = 10000;
      wallet.status = 'active';
      wallet.walletFundingSources = [{
        sourceType: 'self',
        amountKES: 10000,
        restrictedUsage: false,
        restrictedUsageType: 'none'
      }];
      await wallet.save();
    }
    console.log("Student wallet balance and funding sources set to 10,000 KES.");

    // Fetch some approved meals to construct a custom schedule
    const meals = await Meal.find({ approvalStatus: "approved" });
    if (meals.length === 0) {
      console.error("No approved meals found in database to build customSchedule.");
      process.exit(1);
    }
    const lunchMeal = meals.find(m => m.category === "main") || meals[0];
    const supperMeal = meals.find(m => m.category === "main" && m._id.toString() !== lunchMeal._id.toString()) || lunchMeal;
    const breakfastMeal = meals.find(m => m.category === "drink") || meals[0];

    const customSchedule = [];
    for (let i = 0; i < 28; i++) {
      customSchedule.push({
        breakfast: breakfastMeal._id,
        lunch: lunchMeal._id,
        supper: supperMeal._id
      });
    }

    // Let's inspect their cart
    let cart = await Cart.findOne({ user: studentUser._id });
    if (!cart) {
      cart = await Cart.create({ user: studentUser._id, currency: "KES", templates: [], schedule: {} });
    }
    
    // Clear and set a mock monthly plan template with customSchedule
    cart.templates = [
      {
        id: "test-monthly-id",
        label: "Elite Plan",
        qty: 1,
        timeSlot: "Full Board",
        isMonthlyPlan: true,
        billingCycle: "monthly",
        planId: "elite",
        customSchedule: customSchedule,
        main: {
          name: "Full Day Meals",
          price: 4500,
          category: "Main"
        },
        drink: {
          name: "Premium Drink",
          price: 0,
          category: "Drink"
        },
        fruit: {
          name: "None",
          price: 0,
          category: "Fruit"
        }
      }
    ];
    cart.schedule = {};
    await cart.save();
    console.log("Mock monthly plan cart template with customSchedule saved successfully.");

    // Now let's trigger the checkout logic directly to see where it fails
    // We import the cartController to call the checkoutCart function
    const { checkoutCart } = require("../controllers/cartController");
    
    const req = {
      user: { id: studentUser._id.toString() }
    };
    
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        console.log(`Response Status: ${this.statusCode || 200}`);
        console.log("Response JSON:", JSON.stringify(data, null, 2));
      }
    };

    await checkoutCart(req, res);

    // Verify scheduled deliveries
    const Delivery = require("../models/Delivery");
    const deliveries = await Delivery.find({ student: studentUser._id }).sort({ scheduledDate: 1, timeSlot: 1 });
    console.log(`\n[VERIFICATION] Total scheduled deliveries in DB: ${deliveries.length}`);
    
    // Inspect the first day's deliveries (Breakfast, Lunch, Supper)
    const day1Deliveries = deliveries.slice(0, 3);
    console.log("[VERIFICATION] First day's delivery items:");
    day1Deliveries.forEach(d => {
      console.log(`  - Day: ${d.scheduledDate.toISOString().split('T')[0]}, Slot: ${d.timeSlot}, Items: ${JSON.stringify(d.items)}, Cost: ${d.totalCost} KES`);
    });

  } catch (err) {
    console.error("Test failed with error:", err);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed.");
  }
}

run();
