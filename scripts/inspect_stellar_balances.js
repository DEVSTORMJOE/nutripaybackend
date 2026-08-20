require('dotenv').config();
const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const { server } = require('../config/stellarConfig');
const fs = require('fs');

async function inspectStellarAndDB() {
  let out = "=== MONGO DB VS STELLAR ON-CHAIN AUDIT REPORT ===\n\n";
  try {
    await mongoose.connect(process.env.MONGO_URI);

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

    out += "--- MONGO DB LEDGER BALANCES ---\n";
    out += `- Treasury Pool (Student/Sponsor Avail): ${dbTreasuryKES.toFixed(2)} KES\n`;
    out += `- Escrow Pool (Student Locked Subscriptions): ${dbEscrowKES.toFixed(2)} KES\n`;
    out += `- Vendor Settlement Pool (Vendor Avail): ${dbVendorSettlementKES.toFixed(2)} KES\n`;
    out += `- Platform Revenue (Commissions): ${dbRevenueKES.toFixed(2)} KES\n\n`;

    const platformPublics = stellarTreasuryService.platformWallets;
    const NUTRITOKEN_CODE = process.env.NUTRITOKEN_CODE || 'NT';
    const issuerPublic = platformPublics.issuer.public;

    async function getNT(pubKey, name) {
      if (!pubKey) return { nt: 0, xlm: 0 };
      try {
        const acc = await server.loadAccount(pubKey);
        const ntBal = acc.balances.find(x => x.asset_code === NUTRITOKEN_CODE && x.asset_issuer === issuerPublic);
        const xlmBal = acc.balances.find(x => x.asset_type === 'native');
        return {
          nt: ntBal ? parseFloat(ntBal.balance) : 0,
          xlm: xlmBal ? parseFloat(xlmBal.balance) : 0
        };
      } catch (e) {
        return { nt: 0, xlm: 0, error: e.message };
      }
    }

    out += "--- STELLAR ON-CHAIN BALANCES ---\n";
    for (const [key, wallet] of Object.entries(platformPublics)) {
      const res = await getNT(wallet.public, key);
      out += `- ${key.toUpperCase()}: ${res.nt.toFixed(2)} NT | ${res.xlm.toFixed(2)} XLM (Public: ${wallet.public})\n`;
    }

    fs.writeFileSync('stellar_audit_results.txt', out);
    console.log("Audit results written to stellar_audit_results.txt");

  } catch(e) {
    console.error("Inspection error:", e);
  } finally {
    await mongoose.disconnect();
  }
}

inspectStellarAndDB();
