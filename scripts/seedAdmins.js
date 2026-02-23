require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

const admins = [
  {
    name: 'Default Admin',
    email: 'admin@example.com',
    password: 'Admin@123',
    role: 'admin'
  },
  {
    name: 'Super Admin',
    email: 'superadmin@example.com',
    password: 'SuperAdmin@123',
    role: 'admin'
  }
];

const createAdmins = async () => {
  try {
    await connectDB();

    for (const a of admins) {
      const exists = await User.findOne({ email: a.email });
      if (exists) {
        console.log(`Skipping, already exists: ${a.email}`);
        continue;
      }
      const user = new User(a);
      await user.save();
      console.log(`Created admin: ${a.email} / ${a.password}`);
    }

    console.log('Admin seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
};

createAdmins();
