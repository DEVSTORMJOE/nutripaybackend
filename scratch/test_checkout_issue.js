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

    // Let's inspect their cart
    let cart = await Cart.findOne({ user: studentUser._id });
    if (!cart) {
      cart = await Cart.create({ user: studentUser._id, currency: "KES", templates: [], schedule: {} });
    }
    
    // Clear and set a mock monthly plan template
    cart.templates = [
      {
        id: "test-monthly-id",
        label: "Essential Plan",
        qty: 1,
        timeSlot: "Full Board",
        isMonthlyPlan: true,
        billingCycle: "monthly",
        planId: "essential",
        main: {
          name: "Main Dishes Only",
          price: 3500,
          category: "Main"
        },
        drink: {
          name: "Standard Drink",
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
    console.log("Mock monthly plan cart template saved successfully.");

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

  } catch (err) {
    console.error("Test failed with error:", err);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed.");
  }
}

run();
