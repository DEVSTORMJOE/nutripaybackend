const mongoose = require('mongoose');
const User = require('./models/User');
const LoyaltyLog = require('./models/LoyaltyLog');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nutripay');
  const users = await User.find({}).lean();
  console.log(`Found ${users.length} users:`);
  for (const u of users) {
    console.log(`- ${u.email} | Name: ${u.name} | Role: ${u.role} | LoyaltyPoints: ${u.loyaltyPoints || 0} | ID: ${u._id}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
