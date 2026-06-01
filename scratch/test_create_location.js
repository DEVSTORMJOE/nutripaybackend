const mongoose = require('mongoose');
const DeliveryLocation = require('../models/DeliveryLocation');

async function run() {
  const uri = "mongodb://localhost:27017/nutripay";
  await mongoose.connect(uri);
  console.log("Connected.");

  try {
    const loc = await DeliveryLocation.create({
      hostelResidence: "Test Ruwenzori Hostel " + Date.now(),
      university: "Egerton University",
      campus: "Njoro Main Campus"
    });
    console.log("Success! Created DeliveryLocation:", loc);
    await DeliveryLocation.deleteOne({ _id: loc._id });
    console.log("Cleaned up test location.");
  } catch (err) {
    console.error("Failed to create location:", err);
  }

  await mongoose.disconnect();
}

run();
