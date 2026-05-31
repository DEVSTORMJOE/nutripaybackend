const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');
require('dotenv').config();

const SEED_CONFIG = {
  student: 50000,
  sponsor: 100000,
  vendor: 25000,
  admin: 100000
};

async function seed() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
    console.log("Connecting to MongoDB at:", mongoUri.split('@')[1] || mongoUri);
    await mongoose.connect(mongoUri);
    console.log("Connected successfully!");

    const roles = ['student', 'sponsor', 'vendor', 'admin'];

    for (const role of roles) {
      console.log(`\n--- Seeding Role: ${role.toUpperCase()} ---`);
      let users = await User.find({ role });

      // Create a default test account if none exists
      if (users.length === 0) {
        const defaultEmail = `${role}@test.com`;
        console.log(`No users found with role "${role}". Creating default test account: ${defaultEmail}`);
        const defaultUser = await User.create({
          name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
          email: defaultEmail,
          password: "password123", // Will be hashed automatically by userSchema pre-save
          role: role,
          isApproved: true,
          requiresPasswordChange: false
        });
        users = [defaultUser];
      }

      const seedAmount = SEED_CONFIG[role];

      for (const user of users) {
        let wallet = await Wallet.findOne({ user: user._id });

        if (!wallet) {
          console.log(`Creating wallet for ${user.email} (${user.name})...`);
          wallet = new Wallet({
            user: user._id,
            walletType: role,
            availableBalanceKES: seedAmount,
            lockedBalanceKES: 0,
            tokenBalanceNT: seedAmount,
            walletFundingSources: [{
              sourceType: role === 'sponsor' ? 'sponsor' : 'self',
              amountKES: seedAmount,
              restrictedUsage: false,
              restrictedUsageType: 'none'
            }]
          });
        } else {
          console.log(`Updating wallet for ${user.email} (${user.name})...`);
          wallet.availableBalanceKES = seedAmount;
          wallet.lockedBalanceKES = 0;
          wallet.tokenBalanceNT = seedAmount;
          wallet.walletFundingSources = [{
            sourceType: role === 'sponsor' ? 'sponsor' : 'self',
            amountKES: seedAmount,
            restrictedUsage: false,
            restrictedUsageType: 'none'
          }];
        }

        // Save wallet to trigger the pre-save hook that keeps NT mirror perfectly in sync
        await wallet.save();
        console.log(`✅ Wallet seeded: available KES = ${wallet.availableBalanceKES}, NT reserves = ${wallet.tokenBalanceNT}`);

        // Create transaction log for the seed deposit
        await Transaction.create({
          transactionId: crypto.randomUUID(),
          toUser: user._id,
          amountKES: seedAmount,
          transactionCategory: 'deposit',
          paymentMethod: 'mpesa', // simulated deposit
          status: 'completed',
          settlementStatus: 'synced',
          description: `Environment balance seeding of ${seedAmount} KES (1 NT = 1 KES)`
        });
        console.log(`✅ Seed deposit transaction logged.`);
      }
    }

    console.log("\n🎉 Environment Wallet Seeding Completed Successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
