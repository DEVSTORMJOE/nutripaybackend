const mongoose = require('mongoose');

// Override Decimal128 toJSON serialization to prevent frontend React child render crashes
mongoose.Schema.Types.Decimal128.prototype.toJSON = function() {
  return this.toString();
};
if (mongoose.Types && mongoose.Types.Decimal128) {
  mongoose.Types.Decimal128.prototype.toJSON = function() {
    return this.toString();
  };
}

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
