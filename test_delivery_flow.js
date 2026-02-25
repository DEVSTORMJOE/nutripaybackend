const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Vendor = require('./models/Vendor');
const User = require('./models/User');
const Meal = require('./models/Meal');
const Delivery = require('./models/Delivery');

dotenv.config();

async function runTest() {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('MongoDB connected...');

  try {
    // 1. Find a vendor and create a delivery driver for them
    const vendor = await Vendor.findOne().populate('user');
    if (!vendor) throw new Error("No vendor found.");
    
    console.log(`Using Vendor: ${vendor.user.name}`);

    // Create Driver User
    const email = `test_driver_${Date.now()}@nutripay.local`;
    const driver = await User.create({
      name: "Speedy Gonzales",
      email,
      password: "password123",
      role: "delivery",
    });
    
    vendor.deliveryStaff.push(driver._id);
    await vendor.save();
    console.log(`✅ Driver created and registered to Vendor: ${driver.name} (ID: ${driver._id})`);

    // 2. Find a Pending Delivery for this vendor
    const delivery = await Delivery.findOne({ vendor: vendor._id, status: 'pending' });
    if (!delivery) {
       console.log("No pending delivery found for this vendor. Skipping assignment test.");
    } else {
       console.log(`Found pending order ${delivery._id}. Changing state to Ready, then Assigned...`);
       delivery.status = 'ready';
       await delivery.save();
       console.log(`✅ Order status updated to Ready`);

       // Assign Driver
       delivery.status = 'assigned';
       delivery.deliveryAgent = driver._id;
       await delivery.save();
       console.log(`✅ Order successfully Assigned to driver ${driver.name}`);
    }

    // 3. Verify Admin Delivery Endpoint Data shape via direct DB query simulation
    const allDrivers = await User.find({ role: 'delivery' });
    console.log(`Total Drivers Globally for Admin View: ${allDrivers.length}`);

  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

runTest();
