const mongoose = require('mongoose');
const RefundRequest = require('../models/RefundRequest');
const User = require('../models/User');
require('dotenv').config();

async function inspect() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
    await mongoose.connect(mongoUri);
    console.log("Connected successfully!");

    const resUpdate = await RefundRequest.findByIdAndUpdate(
      "6a25e69ea0e8aa0ebe3180c9",
      { $set: { fundingType: "self", sponsor: null } },
      { new: true }
    );
    console.log("Updated refund request:", resUpdate);
  } catch (error) {
    console.error("Failed to inspect/update:", error);
  } finally {
    await mongoose.disconnect();
  }
}

inspect();
