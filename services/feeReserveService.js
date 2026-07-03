const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
const stellarTreasuryService = require('./stellarTreasuryService');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { logAuditEvent } = require('../utils/auditLogger');

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

/**
 * Transfers XLM from the Fee Reserve wallet to the specified target wallet
 * @param {string} targetPublicKey Target wallet address to fund
 * @param {string} amountXLM Amount of XLM to send (default: '10')
 */
async function autoFundWallet(targetPublicKey, amountXLM = '10') {
  try {
    const feeReserve = stellarTreasuryService.platformWallets.feeReserve;
    if (!feeReserve.secret) {
      throw new Error("Fee Reserve secret key is not configured in .env");
    }

    const feeReserveKey = Keypair.fromSecret(feeReserve.secret);
    const account = await server.loadAccount(feeReserveKey.publicKey());

    console.log(`[Fee Reserve] Refueling wallet ${targetPublicKey} with ${amountXLM} XLM...`);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET
    })
      .addOperation(Operation.payment({
        destination: targetPublicKey,
        asset: Asset.native(),
        amount: String(amountXLM)
      }))
      .setTimeout(0)
      .build();

    transaction.sign(feeReserveKey);
    const result = await server.submitTransaction(transaction);
    console.log(`✅ [Fee Reserve] Refuel successful! Tx Hash: ${result.hash}`);
    
    // Log immutable event
    await logAuditEvent(
      'system',
      'Trustline Changes', // categorized under trustline/reserves
      'Wallet',
      [],
      { action: 'auto_fund', targetPublicKey, amountXLM, txHash: result.hash }
    );

    return result.hash;
  } catch (error) {
    console.error(`❌ [Fee Reserve] Auto-funding failed for ${targetPublicKey}:`, error.message);
    throw error;
  }
}

/**
 * Audit on-chain fee reserves and trigger alerts / auto-fueling checks
 */
async function monitorFeeReserve() {
  const threshold = parseFloat(process.env.FEE_RESERVE_MIN_XLM || '20');
  const minWalletBalance = parseFloat(process.env.OPERATIONAL_MIN_XLM || '5');
  const refuelAmount = '10';

  const platformWallets = stellarTreasuryService.platformWallets;
  const results = {
    feeReserveBalanceXLM: 0,
    refuelsTriggered: []
  };

  try {
    // 1. Monitor Fee Reserve balance itself
    if (platformWallets.feeReserve.public) {
      try {
        const acc = await server.loadAccount(platformWallets.feeReserve.public);
        const native = acc.balances.find(b => b.asset_type === 'native');
        const xlmBalance = native ? parseFloat(native.balance) : 0;
        results.feeReserveBalanceXLM = xlmBalance;

        if (xlmBalance < threshold) {
          console.warn(`[Fee Reserve] Low balance alert: Fee Reserve has ${xlmBalance} XLM (Threshold: ${threshold})`);
          
          // Create admin notifications
          const admins = await User.find({ role: 'admin' });
          for (const admin of admins) {
            // Avoid duplicate notifications
            const activeAlert = await Notification.findOne({
              user: admin._id,
              type: 'alert',
              title: '⚠️ Fee Reserve Low Balance Alert',
              isRead: false
            });

            if (!activeAlert) {
              await Notification.create({
                user: admin._id,
                type: 'alert',
                title: '⚠️ Fee Reserve Low Balance Alert',
                message: `Fee Reserve XLM balance (${xlmBalance.toFixed(2)} XLM) is below the threshold of ${threshold} XLM. Please fund it.`
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to load Fee Reserve account:", err.message);
      }
    }

    // 2. Scan and Refuel operational platform accounts (Treasury, Escrow, etc.)
    const operationalWallets = [
      { name: 'Treasury', public: platformWallets.treasury.public },
      { name: 'Escrow', public: platformWallets.escrow.public },
      { name: 'Vendor Settlement', public: platformWallets.vendorSettlement.public },
      { name: 'Revenue', public: platformWallets.revenue.public },
      { name: 'Audit Reserve', public: platformWallets.auditReserve.public }
    ];

    for (const w of operationalWallets) {
      if (!w.public) continue;
      try {
        const acc = await server.loadAccount(w.public);
        const native = acc.balances.find(b => b.asset_type === 'native');
        const balance = native ? parseFloat(native.balance) : 0;

        if (balance < minWalletBalance) {
          console.log(`[Fee Reserve] Wallet ${w.name} (${w.public}) has low fee reserve: ${balance} XLM. Triggering refuel...`);
          const txHash = await autoFundWallet(w.public, refuelAmount);
          results.refuelsTriggered.push({ name: w.name, public: w.public, txHash, refuelAmount });
        }
      } catch (err) {
        if (err.response && err.response.status === 404) {
          // Account not activated: activate it with 10 XLM!
          console.log(`[Fee Reserve] Wallet ${w.name} is not activated on-chain. Activating...`);
          try {
            const txHash = await autoFundWallet(w.public, refuelAmount);
            results.refuelsTriggered.push({ name: w.name, public: w.public, txHash, refuelAmount, activated: true });
          } catch (actErr) {
            console.error(`Failed to activate ${w.name}:`, actErr.message);
          }
        } else {
          console.error(`Failed to audit ${w.name}:`, err.message);
        }
      }
    }

  } catch (error) {
    console.error("Error during fee reserve monitoring:", error.message);
  }

  return results;
}

module.exports = {
  autoFundWallet,
  monitorFeeReserve
};
