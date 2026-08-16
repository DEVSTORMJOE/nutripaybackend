const mongoose = require('mongoose');
require('dotenv').config();
const Wallet = require('../models/Wallet');
const User = require('../models/User');

async function inspect() {
  await mongoose.connect(process.env.MONGO_URI);
  const wallets = await Wallet.find({}).populate('user', 'name email role');
  let treasurySum = 0;
  let escrowSum = 0;

  console.log("=== WALLETS WITH BALANCES ===");
  wallets.forEach(w => {
    const avail = parseFloat(w.availableBalanceKES?.toString() || '0');
    const locked = parseFloat(w.lockedBalanceKES?.toString() || '0');
    const token = parseFloat(w.tokenBalanceNT?.toString() || '0');

    if (w.walletType === 'student' || w.walletType === 'sponsor') {
      treasurySum += avail;
    }
    if (w.walletType === 'student') {
      escrowSum += locked;
    }

    if (avail !== 0 || locked !== 0 || token !== 0) {
      console.log(`User: ${w.user?.name || 'NoUser'} | Role: ${w.user?.role || 'N/A'} | Type: ${w.walletType} | Avail: ${avail} KES | Locked: ${locked} KES | Token: ${token} NT`);
    }
  });

  console.log("\n=== TOTALS ===");
  console.log(`DB Treasury Pool Sum (student + sponsor avail): ${treasurySum} KES`);
  console.log(`DB Escrow Pool Sum (student locked): ${escrowSum} KES`);

  process.exit(0);
}
inspect();
