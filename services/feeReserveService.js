const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
const cron = require('node-cron');
const stellarTreasuryService = require('./stellarTreasuryService');
const User = require('../models/User');
const Notification = require('../models/Notification');
const FeeReserveLog = require('../models/FeeReserveLog');
const { logAuditEvent } = require('../utils/auditLogger');

const { server, NETWORK_PASSPHRASE } = require('../config/stellarConfig');

/**
 * Transfers XLM from the Fee Reserve wallet to the specified target wallet
 * @param {string} targetPublicKey Target wallet address to fund
 * @param {string|number} amountXLM Amount of XLM to send (default: '10')
 * @param {Object} options Context details for FeeReserveLog (walletName, previousBalance, targetBalance, triggeredBy)
 */
async function autoFundWallet(targetPublicKey, amountXLM = '10', options = {}) {
  const {
    walletName = 'Operational Wallet',
    previousBalance = 0,
    targetBalance = 15,
    triggeredBy = 'SYSTEM'
  } = options;

  const sourcePublicKey = stellarTreasuryService.platformWallets.feeReserve.public || 'Fee Reserve';

  try {
    const feeReserve = stellarTreasuryService.platformWallets.feeReserve;
    if (!feeReserve.secret) {
      throw new Error("Fee Reserve secret key is not configured in .env");
    }

    const feeReserveKey = Keypair.fromSecret(feeReserve.secret);
    const account = await server.loadAccount(feeReserveKey.publicKey());

    console.log(`[Fee Reserve] Refueling wallet ${walletName} (${targetPublicKey}) with ${amountXLM} XLM...`);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
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
    console.log(`✅ [Fee Reserve] Refuel successful for ${walletName}! Tx Hash: ${result.hash}`);
    
    // Log in FeeReserveLog
    await FeeReserveLog.create({
      sourceWallet: sourcePublicKey,
      destinationWallet: targetPublicKey,
      destinationWalletName: walletName,
      amountXLM: parseFloat(amountXLM),
      previousBalanceXLM: parseFloat(previousBalance),
      targetBalanceXLM: parseFloat(targetBalance),
      transactionHash: result.hash,
      status: 'SUCCESS',
      triggeredBy
    });

    // Log immutable audit event
    await logAuditEvent(
      'system',
      'Trustline Changes', // categorized under trustline/reserves
      'Wallet',
      [],
      { action: 'auto_fund', walletName, targetPublicKey, amountXLM, txHash: result.hash, triggeredBy }
    );

    return result.hash;
  } catch (error) {
    console.error(`❌ [Fee Reserve] Auto-funding failed for ${walletName} (${targetPublicKey}):`, error.message);
    
    // Log failed attempt in FeeReserveLog
    try {
      await FeeReserveLog.create({
        sourceWallet: sourcePublicKey,
        destinationWallet: targetPublicKey,
        destinationWalletName: walletName,
        amountXLM: parseFloat(amountXLM),
        previousBalanceXLM: parseFloat(previousBalance),
        targetBalanceXLM: parseFloat(targetBalance),
        transactionHash: null,
        status: 'FAILED',
        errorMessage: error.message,
        triggeredBy
      });
    } catch (logErr) {
      console.error("Failed to log fee reserve error:", logErr.message);
    }

    throw error;
  }
}

/**
 * Audit on-chain fee reserves and trigger alerts / dynamic auto-fueling checks
 * @param {string} triggeredBy Context: 'CRON', 'MANUAL_ADMIN', or 'SYSTEM'
 */
async function monitorFeeReserve(triggeredBy = 'MANUAL_ADMIN') {
  const threshold = parseFloat(process.env.FEE_RESERVE_MIN_XLM || '20');
  const minWalletBalance = parseFloat(process.env.OPERATIONAL_MIN_XLM || '5');
  const targetWalletBalance = parseFloat(process.env.OPERATIONAL_TARGET_XLM || '15');

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
          // Dynamic deficit calculation: transfer only the amount needed to restore target balance!
          const neededXLM = Number(Math.max(0, targetWalletBalance - balance).toFixed(7));
          if (neededXLM > 0) {
            console.log(`[Fee Reserve] Wallet ${w.name} (${w.public}) has low fee reserve: ${balance} XLM (Min: ${minWalletBalance}). Transferring ${neededXLM} XLM to restore target (${targetWalletBalance} XLM)...`);
            const txHash = await autoFundWallet(w.public, String(neededXLM), {
              walletName: w.name,
              previousBalance: balance,
              targetBalance: targetWalletBalance,
              triggeredBy
            });
            results.refuelsTriggered.push({ name: w.name, public: w.public, txHash, refuelAmount: String(neededXLM), currentBalance: balance, restoredTarget: targetWalletBalance });
          }
        }
      } catch (err) {
        if (err.response && err.response.status === 404) {
          // Account not activated: activate it with full target balance (e.g. 15 XLM)!
          console.log(`[Fee Reserve] Wallet ${w.name} is not activated on-chain. Activating with ${targetWalletBalance} XLM...`);
          try {
            const txHash = await autoFundWallet(w.public, String(targetWalletBalance), {
              walletName: w.name,
              previousBalance: 0,
              targetBalance: targetWalletBalance,
              triggeredBy
            });
            results.refuelsTriggered.push({ name: w.name, public: w.public, txHash, refuelAmount: String(targetWalletBalance), activated: true });
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

/**
 * Initializes automated background cron schedule for Fee Reserve monitoring
 */
function startFeeReserveScheduler() {
  const cronSchedule = process.env.FEE_RESERVE_CRON_SCHEDULE || '0 * * * *'; // Default: every 1 hour
  console.log(`[Fee Reserve Scheduler] Initialized background monitoring (Schedule: "${cronSchedule}")`);

  cron.schedule(cronSchedule, async () => {
    console.log(`[Fee Reserve Scheduler] Running scheduled fee reserve audit...`);
    try {
      await monitorFeeReserve('CRON');
    } catch (err) {
      console.error("[Fee Reserve Scheduler] Execution error:", err.message);
    }
  });
}

/**
 * Fetch current on-chain XLM balances and health status for all platform operational wallets
 */
async function getOperationalWalletBalances() {
  const feeReserveMin = parseFloat(process.env.FEE_RESERVE_MIN_XLM || '20');
  const minWalletBalance = parseFloat(process.env.OPERATIONAL_MIN_XLM || '5');
  const targetWalletBalance = parseFloat(process.env.OPERATIONAL_TARGET_XLM || '15');

  const platformWallets = stellarTreasuryService.platformWallets;
  const wallets = [
    { name: 'Fee Reserve (Gas Pool)', public: platformWallets.feeReserve.public, isFeeReserve: true, minThreshold: feeReserveMin, target: null },
    { name: 'Treasury (User Available Pool)', public: platformWallets.treasury.public, isFeeReserve: false, minThreshold: minWalletBalance, target: targetWalletBalance },
    { name: 'Escrow (Locked Subscriptions)', public: platformWallets.escrow.public, isFeeReserve: false, minThreshold: minWalletBalance, target: targetWalletBalance },
    { name: 'Vendor Settlement (Released Cash)', public: platformWallets.vendorSettlement.public, isFeeReserve: false, minThreshold: minWalletBalance, target: targetWalletBalance },
    { name: 'Platform Revenue (Commissions)', public: platformWallets.revenue.public, isFeeReserve: false, minThreshold: minWalletBalance, target: targetWalletBalance },
    { name: 'Audit Reserve (Fraud Isolated)', public: platformWallets.auditReserve.public, isFeeReserve: false, minThreshold: minWalletBalance, target: targetWalletBalance }
  ];

  const walletStatuses = [];

  for (const w of wallets) {
    if (!w.public) {
      walletStatuses.push({
        name: w.name,
        publicKey: null,
        balanceXLM: 0,
        minThresholdXLM: w.minThreshold,
        targetXLM: w.target,
        status: 'UNCONFIGURED',
        isFeeReserve: w.isFeeReserve
      });
      continue;
    }

    try {
      const acc = await server.loadAccount(w.public);
      const native = acc.balances.find(b => b.asset_type === 'native');
      const balance = native ? parseFloat(native.balance) : 0;
      const isLow = balance < w.minThreshold;

      walletStatuses.push({
        name: w.name,
        publicKey: w.public,
        balanceXLM: balance,
        minThresholdXLM: w.minThreshold,
        targetXLM: w.target,
        status: isLow ? 'LOW' : 'HEALTHY',
        isFeeReserve: w.isFeeReserve
      });
    } catch (err) {
      if (err.response && err.response.status === 404) {
        walletStatuses.push({
          name: w.name,
          publicKey: w.public,
          balanceXLM: 0,
          minThresholdXLM: w.minThreshold,
          targetXLM: w.target,
          status: 'UNACTIVATED',
          isFeeReserve: w.isFeeReserve
        });
      } else {
        walletStatuses.push({
          name: w.name,
          publicKey: w.public,
          balanceXLM: 0,
          minThresholdXLM: w.minThreshold,
          targetXLM: w.target,
          status: 'ERROR',
          errorMessage: err.message,
          isFeeReserve: w.isFeeReserve
        });
      }
    }
  }

  return walletStatuses;
}

module.exports = {
  autoFundWallet,
  monitorFeeReserve,
  startFeeReserveScheduler,
  getOperationalWalletBalances
};

