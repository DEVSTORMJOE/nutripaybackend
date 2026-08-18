const mongoose = require('mongoose');
require('dotenv').config();
const Wallet = require('../models/Wallet');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');
const { server } = require('../config/stellarConfig');

async function rebalanceEscrow() {
  console.log("=======================================================================");
  console.log("⚖️  REBALANCING STELLAR ESCROW ON-CHAIN PROOF TO MATCH MONGO DB LEDGER");
  console.log("=======================================================================");

  const mongoUri = process.env.MONGO_URI || "mongodb+srv://mainafrank400_db_user:N7Og3gx1cvVI0AnS@nutri.xyyf1zm.mongodb.net/?appName=nutri";
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");

  // 1. Calculate MongoDB Escrow total
  const wallets = await Wallet.find({});
  let dbEscrowKES = 0;
  wallets.forEach(w => {
    if (w.walletType === 'student') {
      const locked = parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0');
      dbEscrowKES += locked;
    }
  });
  dbEscrowKES = Number(dbEscrowKES.toFixed(2));

  // 2. Query On-Chain Stellar Escrow NT balance
  const platformPublics = stellarTreasuryService.platformWallets;
  const account = await server.loadAccount(platformPublics.escrow.public);
  const issuerPublic = platformPublics.issuer.public;
  const NUTRITOKEN_CODE = process.env.NUTRITOKEN_CODE || 'NT';
  const native = account.balances.find(
    b => b.asset_code === NUTRITOKEN_CODE && b.asset_issuer === issuerPublic
  );
  const onChainEscrowNT = native ? parseFloat(native.balance) : 0;

  console.log(`\n📊 Current Status:`);
  console.log(`   - MongoDB DB Escrow (Locked Subscriptions): ${dbEscrowKES.toFixed(2)} KES`);
  console.log(`   - Stellar On-Chain Escrow Balance:         ${onChainEscrowNT.toFixed(2)} NT`);
  console.log(`   - Discrepancy:                              ${(dbEscrowKES - onChainEscrowNT).toFixed(2)} KES`);

  const offset = Number((onChainEscrowNT - dbEscrowKES).toFixed(2));

  if (offset > 0) {
    console.log(`\n🔄 Transferring ${offset.toFixed(2)} NT from Stellar Escrow -> Stellar Treasury to rebalance...`);
    const txHash = await stellarTreasuryService.performPlatformTransfer(
      platformPublics.escrow.secret,
      platformPublics.treasury.public,
      offset,
      `Rebalance Escrow excess ${offset} NT to Treasury`
    );
    console.log(`✅ On-chain rebalance completed! Tx Hash: ${txHash}`);
  } else if (offset < 0) {
    const transferBack = Math.abs(offset);
    console.log(`\n🔄 Transferring ${transferBack.toFixed(2)} NT from Stellar Treasury -> Stellar Escrow to rebalance...`);
    const txHash = await stellarTreasuryService.performPlatformTransfer(
      platformPublics.treasury.secret,
      platformPublics.escrow.public,
      transferBack,
      `Rebalance Treasury to Escrow deficit ${transferBack} NT`
    );
    console.log(`✅ On-chain rebalance completed! Tx Hash: ${txHash}`);
  } else {
    console.log(`\n✅ Stellar Escrow and DB Cache are ALREADY in 100% alignment!`);
  }

  // 3. Verify final reconciliation status
  console.log("\nRunning Full Proof-of-Reserves Reconciliation Audit...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 SUCCESS! Stellar Escrow and Treasury are in 100% Alignment (0.00 KES Variance)!");
  } else {
    console.log("⚠️ Discrepancy report finished.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

rebalanceEscrow().catch(err => {
  console.error("Rebalance script failed:", err);
  process.exit(1);
});
