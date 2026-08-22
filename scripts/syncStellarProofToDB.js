const mongoose = require('mongoose');
require('dotenv').config();
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const reconciliationService = require('../services/reconciliationService');
const { server } = require('../config/stellarConfig');

async function syncProofToDB() {
  console.log("=======================================================================");
  console.log("🔥 REBALANCING STELLAR PROOF OF RESERVES TO MONGO DB LEDGER (ALL POOLS)");
  console.log("=======================================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  // 1. Calculate MongoDB Totals
  const wallets = await Wallet.find({});
  let dbTreasuryKES = 0;
  let dbEscrowKES = 0;
  let dbVendorSettlementKES = 0;

  wallets.forEach(w => {
    const avail = parseFloat(w.availableBalanceKES ? w.availableBalanceKES.toString() : '0');
    const locked = parseFloat(w.lockedBalanceKES ? w.lockedBalanceKES.toString() : '0');
    if (w.walletType === 'student' || w.walletType === 'sponsor') {
      dbTreasuryKES += avail;
    }
    if (w.walletType === 'student') {
      dbEscrowKES += locked;
    }
    if (w.walletType === 'vendor') {
      dbVendorSettlementKES += avail;
    }
  });

  const commissionTxs = await Transaction.find({ transactionCategory: 'commission', status: 'completed' });
  let dbRevenueKES = commissionTxs.reduce((sum, tx) => sum + parseFloat(tx.amountKES ? tx.amountKES.toString() : '0'), 0);

  dbTreasuryKES = Number(dbTreasuryKES.toFixed(2));
  dbEscrowKES = Number(dbEscrowKES.toFixed(2));
  dbVendorSettlementKES = Number(dbVendorSettlementKES.toFixed(2));
  dbRevenueKES = Number(dbRevenueKES.toFixed(2));

  // 2. Query On-Chain Stellar Balances
  const platformPublics = stellarTreasuryService.platformWallets;
  const NUTRITOKEN_CODE = process.env.NUTRITOKEN_CODE || 'NT';
  const issuerPublic = platformPublics.issuer.public;

  async function getNT(pubKey) {
    if (!pubKey) return 0;
    try {
      const acc = await server.loadAccount(pubKey);
      const b = acc.balances.find(x => x.asset_code === NUTRITOKEN_CODE && x.asset_issuer === issuerPublic);
      return b ? parseFloat(b.balance) : 0;
    } catch (e) {
      return 0;
    }
  }

  const onChainTreasuryNT = await getNT(platformPublics.treasury.public);
  const onChainEscrowNT = await getNT(platformPublics.escrow.public);
  const onChainVendorSettlementNT = await getNT(platformPublics.vendorSettlement.public);
  const onChainRevenueNT = await getNT(platformPublics.revenue.public);

  console.log(`\n📊 Status Before Sync:`);
  console.log(`   - Treasury:         DB = ${dbTreasuryKES.toFixed(2)} KES | Stellar = ${onChainTreasuryNT.toFixed(2)} NT`);
  console.log(`   - Escrow:           DB = ${dbEscrowKES.toFixed(2)} KES | Stellar = ${onChainEscrowNT.toFixed(2)} NT`);
  console.log(`   - VendorSettlement: DB = ${dbVendorSettlementKES.toFixed(2)} KES | Stellar = ${onChainVendorSettlementNT.toFixed(2)} NT`);
  console.log(`   - Revenue:          DB = ${dbRevenueKES.toFixed(2)} KES | Stellar = ${onChainRevenueNT.toFixed(2)} NT`);

  // 3. Align Escrow if needed
  const escrowDiff = Number((onChainEscrowNT - dbEscrowKES).toFixed(2));
  if (escrowDiff > 0) {
    console.log(`\n🔄 Moving ${escrowDiff} NT from Escrow -> Treasury...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.escrow.secret,
      platformPublics.treasury.public,
      escrowDiff,
      "Rebalance Escrow excess to Treasury"
    );
  } else if (escrowDiff < 0) {
    const toEscrow = Math.abs(escrowDiff);
    console.log(`\n🔄 Moving ${toEscrow} NT from Treasury -> Escrow...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.treasury.secret,
      platformPublics.escrow.public,
      toEscrow,
      "Rebalance Treasury to Escrow deficit"
    );
  }

  // 4. Align VendorSettlement if needed
  const vendorDiff = Number((onChainVendorSettlementNT - dbVendorSettlementKES).toFixed(2));
  if (vendorDiff > 0) {
    console.log(`\n🔥 Returning ${vendorDiff} NT excess from VendorSettlement -> Issuer...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.vendorSettlement.secret,
      platformPublics.issuer.public,
      vendorDiff,
      "Return VendorSettlement excess NT to Issuer"
    );
  } else if (vendorDiff < 0) {
    const needed = Math.abs(vendorDiff);
    console.log(`\n🪙 Minting ${needed} NT from Issuer -> VendorSettlement...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.issuer.secret,
      platformPublics.vendorSettlement.public,
      needed,
      "Mint NT to back VendorSettlement deficit"
    );
  }

  // 5. Align Revenue if needed
  const revenueDiff = Number((onChainRevenueNT - dbRevenueKES).toFixed(2));
  if (revenueDiff > 0) {
    console.log(`\n🔥 Returning ${revenueDiff} NT excess from Revenue -> Issuer...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.revenue.secret,
      platformPublics.issuer.public,
      revenueDiff,
      "Return Revenue excess NT to Issuer"
    );
  } else if (revenueDiff < 0) {
    const needed = Math.abs(revenueDiff);
    console.log(`\n🪙 Minting ${needed} NT from Issuer -> Revenue...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.issuer.secret,
      platformPublics.revenue.public,
      needed,
      "Mint NT to back Revenue deficit"
    );
  }

  // 6. Align Treasury (Burn/Return unbacked testnet NT to Issuer)
  const updatedTreasuryNT = await getNT(platformPublics.treasury.public);
  const treasuryDiff = Number((updatedTreasuryNT - dbTreasuryKES).toFixed(2));

  if (treasuryDiff > 0) {
    console.log(`\n🔥 Returning ${treasuryDiff} unbacked testnet NT from Treasury -> Issuer...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.treasury.secret,
      platformPublics.issuer.public,
      treasuryDiff,
      "Return unbacked testnet NT to Issuer"
    );
    console.log(`✅ Returned ${treasuryDiff} NT to Issuer.`);
  } else if (treasuryDiff < 0) {
    const needed = Math.abs(treasuryDiff);
    console.log(`\n🪙 Minting ${needed} NT from Issuer -> Treasury to back DB balance...`);
    await stellarTreasuryService.performPlatformTransfer(
      platformPublics.issuer.secret,
      platformPublics.treasury.public,
      needed,
      "Mint NT to back DB Treasury balance"
    );
    console.log(`✅ Minted ${needed} NT to Treasury.`);
  }

  // 7. Final Proof-of-Reserves Verification
  console.log("\nRunning Final Proof-of-Reserves Audit Verification...");
  const report = await reconciliationService.runFullReconciliation();

  console.log("\n=======================================================================");
  if (report.success) {
    console.log("🎉 SUCCESS! Stellar Blockchain Proof & MongoDB Ledger are in 100% PERFECT ALIGNMENT!");
  } else {
    console.log("⚠️ Audit complete with status output above.");
  }
  console.log("=======================================================================");

  process.exit(0);
}

syncProofToDB().catch(err => {
  console.error("Sync script error:", err);
  process.exit(1);
});
