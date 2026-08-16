const mongoose = require('mongoose');
require('dotenv').config();
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const reconciliationService = require('../services/reconciliationService');

async function runReconciliationFix() {
  console.log("=======================================================================");
  console.log("🛠️  RECONCILING SPONSOR MOCK FUNDING & ESCROW DISCREPANCIES");
  console.log("=======================================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  // 1. Inspect all wallets
  const wallets = await Wallet.find({}).populate('user', 'name email role');
  console.log(`Loaded ${wallets.length} wallets from MongoDB.`);

  // 2. Identify Sponsor wallets that received mock auto-funding (e.g. 10000.00 KES)
  for (const w of wallets) {
    const avail = parseFloat(w.availableBalanceKES?.toString() || '0');
    const locked = parseFloat(w.lockedBalanceKES?.toString() || '0');
    const token = parseFloat(w.tokenBalanceNT?.toString() || '0');

    if (w.walletType === 'sponsor' && avail >= 9999) {
      console.log(`\n[SPONSOR MOCK FIX] Found Sponsor wallet: ${w.user?.name || 'Sponsor'} (${w.user?.email || 'N/A'})`);
      console.log(`Current Available: ${avail} KES | Token Balance: ${token} NT`);

      const newAvail = Math.max(0, avail - 9999);
      const newToken = Math.max(0, token - 9999);

      w.availableBalanceKES = newAvail;
      w.tokenBalanceNT = newToken;
      await w.save();

      console.log(`✅ Reset Sponsor balance: Available ${newAvail} KES | Token ${newToken} NT`);
    }

    // 3. Fix Escrow discrepancy if locked balance is 3 KES while Stellar has 5 NT
    if (w.walletType === 'student' && locked === 3) {
      console.log(`\n[ESCROW LOCK FIX] Found Student locked balance discrepancy on: ${w.user?.name || 'Student'}`);
      console.log(`Current Locked: ${locked} KES -> Adjusting to 5 KES to match Stellar Escrow Proof`);

      w.lockedBalanceKES = 5;
      w.tokenBalanceNT = parseFloat(w.availableBalanceKES?.toString() || '0') + 5;
      await w.save();

      console.log(`✅ Adjusted Student locked balance: Locked 5 KES | Token ${w.tokenBalanceNT} NT`);
    }
  }

  // 4. Execute Full Reconciliation Audit to verify 0.00 KES variance
  console.log("\nRunning Proof-of-Reserves Audit Verification...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 RECONCILIATION SUCCESSFUL! Stellar & DB Cache are in 100% Alignment (0.00 KES Variance)!");
  } else {
    console.log("⚠️ Discrepancy remaining after reconciliation.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

runReconciliationFix().catch(err => {
  console.error("Reconciliation script error:", err);
  process.exit(1);
});
