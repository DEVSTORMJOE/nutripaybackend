const mongoose = require('mongoose');
require('dotenv').config();
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');
const { server } = require('../config/stellarConfig');

async function autoRebalanceAllVaults() {
  console.log("=======================================================================");
  console.log("🔄 DYNAMIC STELLAR PROOF REBALANCE TO 0.00 KES VARIANCE");
  console.log("=======================================================================");

  await mongoose.connect(process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri");
  console.log("Connected to MongoDB.");

  // 1. Compute DB Cache Balances
  const wallets = await Wallet.find({});
  let dbTreasuryKES = 0;
  let dbEscrowKES = 0;

  wallets.forEach(w => {
    const avail = parseFloat(w.availableBalanceKES ? w.availableBalanceKES.toString() : '0');
    const locked = parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0');
    if (w.walletType === 'student' || w.walletType === 'sponsor') {
      dbTreasuryKES += avail;
    }
    if (w.walletType === 'student') {
      dbEscrowKES += locked;
    }
  });

  dbTreasuryKES = Number(dbTreasuryKES.toFixed(2));
  dbEscrowKES = Number(dbEscrowKES.toFixed(2));

  // 2. Compute On-Chain Stellar Balances
  const platformPublics = stellarTreasuryService.platformWallets;
  const NUTRITOKEN_CODE = process.env.NUTRITOKEN_CODE || 'NT';
  const issuerPublic = platformPublics.issuer.public;

  async function getStellarBalance(pubKey) {
    try {
      const acc = await server.loadAccount(pubKey);
      const b = acc.balances.find(x => x.asset_code === NUTRITOKEN_CODE && x.asset_issuer === issuerPublic);
      return b ? parseFloat(b.balance) : 0;
    } catch (e) {
      return 0;
    }
  }

  const onChainTreasury = await getStellarBalance(platformPublics.treasury.public);
  const onChainEscrow = await getStellarBalance(platformPublics.escrow.public);

  console.log(`\n📊 DB Cache vs On-Chain Status:`);
  console.log(`   - Treasury: DB = ${dbTreasuryKES} KES | Stellar = ${onChainTreasury} NT`);
  console.log(`   - Escrow:   DB = ${dbEscrowKES} KES | Stellar = ${onChainEscrow} NT`);

  // 3. Rebalance Escrow pool if excess on-chain
  const escrowExcess = Number((onChainEscrow - dbEscrowKES).toFixed(2));
  if (escrowExcess > 0) {
    console.log(`\n🔄 Moving ${escrowExcess} NT excess from Stellar Escrow -> Audit Reserve...`);
    try {
      const tx = await stellarTreasuryService.performPlatformTransfer(
        platformPublics.escrow.secret,
        platformPublics.auditReserve.public,
        escrowExcess,
        `Dynamic Rebalance Escrow to DB (${dbEscrowKES} KES)`
      );
      console.log(`✅ Escrow dynamic alignment hash: ${tx}`);
    } catch (err) {
      console.error("Escrow alignment error:", err.message);
    }
  }

  // 4. Rebalance Treasury pool if excess on-chain
  const treasuryExcess = Number((onChainTreasury - dbTreasuryKES).toFixed(2));
  if (treasuryExcess > 0) {
    console.log(`\n🔄 Moving ${treasuryExcess} NT excess from Stellar Treasury -> Audit Reserve...`);
    try {
      const tx = await stellarTreasuryService.performPlatformTransfer(
        platformPublics.treasury.secret,
        platformPublics.auditReserve.public,
        treasuryExcess,
        `Dynamic Rebalance Treasury to DB (${dbTreasuryKES} KES)`
      );
      console.log(`✅ Treasury dynamic alignment hash: ${tx}`);
    } catch (err) {
      console.error("Treasury alignment error:", err.message);
    }
  }

  // 5. Run Full Audit Verification
  console.log("\nRunning Full Proof-of-Reserves Audit...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 ALL POOLS ARE IN PERFECT 100% (0.00 KES) ALIGNMENT!");
  } else {
    console.log("⚠️ Audit complete. Review status output above.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

autoRebalanceAllVaults().catch(err => {
  console.error("Auto rebalance failed:", err);
  process.exit(1);
});
