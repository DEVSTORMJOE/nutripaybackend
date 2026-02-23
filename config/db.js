const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Use environment variable or fallback to local for dev
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
