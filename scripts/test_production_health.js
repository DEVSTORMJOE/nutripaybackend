const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const { getProductionHealth } = require('../controllers/healthController');

async function testHealth() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nutripay');
    console.log("Connected to MongoDB for Health Probe Verification.");

    const mockReq = {};
    const mockRes = {
      json: (data) => {
        console.log("=== Health Probe Summary ===");
        console.log(JSON.stringify(data.summary, null, 2));
        console.log(`Total Indicators Probed: ${data.indicators.length}`);
        console.log("Sample Indicators:");
        data.indicators.forEach(i => console.log(`  - [${i.status.toUpperCase()}] ${i.name} (${i.latencyMs}ms): ${i.details}`));
      },
      status: (code) => {
        console.log("Response status code:", code);
        return mockRes;
      }
    };

    await getProductionHealth(mockReq, mockRes);
    console.log("✅ Production Health Probe test completed successfully!");

    await mongoose.disconnect();
  } catch (err) {
    console.error("Health probe test failed:", err);
    process.exit(1);
  }
}

testHealth();
