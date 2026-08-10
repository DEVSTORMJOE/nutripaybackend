const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
require('dotenv').config();

const { server, HORIZON_URL, NETWORK_PASSPHRASE, getEnv } = require('../config/stellarConfig');

// Platform Keypairs (Unified STELLAR_<NAME>_PUBLIC / STELLAR_<NAME>_SECRET Naming Convention)
const platformWallets = {
  issuer: {
    public: getEnv('STELLAR_ISSUER_PUBLIC'),
    secret: getEnv('STELLAR_ISSUER_SECRET'),
  },
  treasury: {
    public: getEnv('STELLAR_TREASURY_PUBLIC'),
    secret: getEnv('STELLAR_TREASURY_SECRET'),
  },
  escrow: {
    public: getEnv('STELLAR_ESCROW_PUBLIC'),
    secret: getEnv('STELLAR_ESCROW_SECRET'),
  },
  vendorSettlement: {
    public: getEnv('STELLAR_VENDOR_SETTLEMENT_PUBLIC'),
    secret: getEnv('STELLAR_VENDOR_SETTLEMENT_SECRET'),
  },
  revenue: {
    public: getEnv('STELLAR_REVENUE_PUBLIC'),
    secret: getEnv('STELLAR_REVENUE_SECRET'),
  },
  auditReserve: {
    public: getEnv('STELLAR_AUDIT_RESERVE_PUBLIC'),
    secret: getEnv('STELLAR_AUDIT_RESERVE_SECRET'),
  },
  feeReserve: {
    public: getEnv('STELLAR_FEE_RESERVE_PUBLIC'),
    secret: getEnv('STELLAR_FEE_RESERVE_SECRET'),
  }
};

// Strict Environment Guard: Abort startup immediately if any platform wallet key is missing
const missingKeys = [];
Object.entries(platformWallets).forEach(([name, keys]) => {
  if (!keys.public) missingKeys.push(`${name.toUpperCase()} public key`);
  if (!keys.secret) missingKeys.push(`${name.toUpperCase()} secret key`);
});

if (missingKeys.length > 0) {
  console.error("❌ CRITICAL STELLAR STARTUP ERROR: Missing platform wallet keys:");
  missingKeys.forEach(k => console.error(`   - Missing: ${k}`));
  console.error("❌ Server startup aborted to prevent fund orphaning or unbacked state execution.");
  throw new Error(`CRITICAL STELLAR CONFIGURATION ERROR: Missing required platform keys [${missingKeys.join(', ')}]. Server startup aborted.`);
}

// NutriToken (NT) Asset Definition (1 NT = 1 KES)
const NUTRITOKEN_CODE = getEnv('NUTRITOKEN_CODE', 'NT');
const NT = new Asset(NUTRITOKEN_CODE, platformWallets.issuer.public);

/**
 * Utility to format amount to 7 decimal places as required by Stellar SDK
 */
function formatAmount(amount) {
  return Number(amount).toFixed(7);
}

/**
 * Creates a trustline for an account to accept the custom NT token
 * @param {string} accountSecret The secret key of the account establishing the trustline
 */
async function createTrustline(accountSecret) {
  try {
    const keypair = Keypair.fromSecret(accountSecret);
    console.log(`[Stellar Platform Trustline] Establishing trustline for ${keypair.publicKey()} to accept ${NUTRITOKEN_CODE}...`);

    const account = await server.loadAccount(keypair.publicKey());

    // Check if trustline already exists
    const hasTrustline = account.balances.some(
      b => b.asset_code === NUTRITOKEN_CODE && b.asset_issuer === platformWallets.issuer.public
    );

    if (hasTrustline) {
      console.log(`✅ Trustline already exists for ${keypair.publicKey()}`);
      return "already_exists";
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(Operation.changeTrust({
        asset: NT
      }))
      .setTimeout(0)
      .build();

    transaction.sign(keypair);
    const result = await server.submitTransaction(transaction);
    console.log(`✅ Trustline successfully established! Tx Hash: ${result.hash}`);
    return result.hash;
  } catch (error) {
    console.error("❌ Stellar ChangeTrust Operation Failed:", error.response?.data?.extras || error.message || error);
    throw error;
  }
}

/**
 * Perform a generic token payment between platform accounts
 */
async function performPlatformTransfer(sourceSecret, destinationPublic, amountKES, description = "") {
  try {
    const tokenAmount = formatAmount(amountKES);
    console.log(`[Stellar Platform Settlement] Transferring: ${amountKES} ${NUTRITOKEN_CODE} -> ${destinationPublic}. Desc: ${description}`);

    if (parseFloat(tokenAmount) <= 0) {
      throw new Error(`Converted ${NUTRITOKEN_CODE} amount is 0 or less`);
    }

    const sourceKey = Keypair.fromSecret(sourceSecret);
    const account = await server.loadAccount(sourceKey.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(Operation.payment({
        destination: destinationPublic,
        asset: NT,
        amount: tokenAmount
      }))
      .setTimeout(0)
      .build();

    transaction.sign(sourceKey);

    const result = await server.submitTransaction(transaction);
    console.log(`✅ Stellar token settlement success! Tx Hash: ${result.hash}`);
    return result.hash;
  } catch (error) {
    if (error.response && error.response.data) {
      console.error("❌ Stellar Token Transfer Failed:", JSON.stringify(error.response.data.extras || error.response.data, null, 2));
    } else {
      console.error("❌ Stellar Token Transfer Failed:", error.message || error);
    }
    throw error;
  }
}

/**
 * Mint NT: Transfer from ISSUER to TREASURY (triggered on M-Pesa deposit success)
 */
async function mintNT(amountKes) {
  return performPlatformTransfer(
    platformWallets.issuer.secret,
    platformWallets.treasury.public,
    amountKes,
    `Mint ${amountKes} NT: Issuer -> Treasury`
  );
}

/**
 * Lock subscription funds: Transfer from TREASURY to ESCROW
 */
async function settleToEscrow(amountKes) {
  return performPlatformTransfer(
    platformWallets.treasury.secret,
    platformWallets.escrow.public,
    amountKes,
    `Lock Subscription: Treasury -> Escrow`
  );
}

/**
 * Release daily payout from ESCROW to VENDOR_SETTLEMENT (delivery complete)
 */
async function releaseVendorSettlement(amountKes) {
  return performPlatformTransfer(
    platformWallets.escrow.secret,
    platformWallets.vendorSettlement.public,
    amountKes,
    `Release Vendor Share: Escrow -> Vendor Settlement`
  );
}

/**
 * Record platform commission from ESCROW to REVENUE
 */
async function recordRevenue(amountKes) {
  return performPlatformTransfer(
    platformWallets.escrow.secret,
    platformWallets.revenue.public,
    amountKes,
    `Record Commission: Escrow -> Revenue`
  );
}

/**
 * Refund subscription cancelled meals: Transfer from ESCROW back to TREASURY
 */
async function reverseSettlement(amountKes) {
  return performPlatformTransfer(
    platformWallets.escrow.secret,
    platformWallets.treasury.public,
    amountKes,
    `Reverse Settlement: Escrow -> Treasury (Refund)`
  );
}

/**
 * Burn tokens/Redeem on Cash Out: Transfer from VENDOR_SETTLEMENT to TREASURY
 */
async function moveVendorToTreasury(amountKes) {
  return performPlatformTransfer(
    platformWallets.vendorSettlement.secret,
    platformWallets.treasury.public,
    amountKes,
    `Redeem Tokens on Withdrawal: Vendor Settlement -> Treasury`
  );
}

/**
 * Redeem Revenue on Platform Profit Cash Out: Transfer from REVENUE to TREASURY
 */
async function withdrawRevenueToTreasury(amountKes) {
  return performPlatformTransfer(
    platformWallets.revenue.secret,
    platformWallets.treasury.public,
    amountKes,
    `Redeem Revenue Profit on Withdrawal: Revenue -> Treasury`
  );
}

module.exports = {
  createTrustline,
  mintNT,
  settleToEscrow,
  releaseVendorSettlement,
  recordRevenue,
  reverseSettlement,
  moveVendorToTreasury,
  withdrawRevenueToTreasury,
  platformWallets,
  NT,
  NUTRITOKEN_CODE
};
