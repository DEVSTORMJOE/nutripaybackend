const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
require('dotenv').config();

// Helper to safely fetch environment variables and strip any potential surrounding quotes
function getEnv(key, defaultValue = "") {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.replace(/['"]/g, "").trim();
}

// Dynamically generate Audit Reserve and Fee Reserve keys if they don't exist
const fs = require('fs');
const path = require('path');

let auditReservePublic = getEnv('STELLAR_AUDIT_RESERVE_PUBLIC');
let auditReserveSecret = getEnv('STELLAR_AUDIT_RESERVE_SECRET');
let feeReservePublic = getEnv('STELLAR_FEE_RESERVE_PUBLIC');
let feeReserveSecret = getEnv('STELLAR_FEE_RESERVE_SECRET');

if (!auditReservePublic || !auditReserveSecret || !feeReservePublic || !feeReserveSecret) {
  console.log("[Stellar Platform Initialization] Creating missing Audit Reserve / Fee Reserve keys...");
  const envPath = path.join(__dirname, '../.env');
  let appendContent = '\n# Dynamic Reserve Keys for Production Readiness\n';

  if (!auditReservePublic || !auditReserveSecret) {
    const pair = Keypair.random();
    auditReservePublic = pair.publicKey();
    auditReserveSecret = pair.secret();
    appendContent += `STELLAR_AUDIT_RESERVE_PUBLIC=${auditReservePublic}\nSTELLAR_AUDIT_RESERVE_SECRET=${auditReserveSecret}\n`;
    process.env.STELLAR_AUDIT_RESERVE_PUBLIC = auditReservePublic;
    process.env.STELLAR_AUDIT_RESERVE_SECRET = auditReserveSecret;
  }
  if (!feeReservePublic || !feeReserveSecret) {
    const pair = Keypair.random();
    feeReservePublic = pair.publicKey();
    feeReserveSecret = pair.secret();
    appendContent += `STELLAR_FEE_RESERVE_PUBLIC=${feeReservePublic}\nSTELLAR_FEE_RESERVE_SECRET=${feeReserveSecret}\n`;
    process.env.STELLAR_FEE_RESERVE_PUBLIC = feeReservePublic;
    process.env.STELLAR_FEE_RESERVE_SECRET = feeReserveSecret;
  }

  if (fs.existsSync(envPath)) {
    fs.appendFileSync(envPath, appendContent);
    console.log("[Stellar Platform Initialization] Persisted reserve keys to backend .env");
  }
}

// Horizon URL & Network Passphrase Configuration
const HORIZON_URL = getEnv('HORIZON_URL', 'https://horizon-testnet.stellar.org');
const NETWORK_PASSPHRASE = getEnv('NETWORK_PASSPHRASE', Networks.TESTNET);

const server = new Horizon.Server(HORIZON_URL);

// Platform Keypairs
const platformWallets = {
  issuer: {
    public: getEnv('ISSUER_PUBLIC_KEY') || getEnv('STELLAR_ISSUER_PUBLIC'),
    secret: getEnv('ISSUER_SECRET_KEY') || getEnv('STELLAR_ISSUER_SECRET'),
  },
  treasury: {
    public: getEnv('TREASURY_PUBLIC_KEY') || getEnv('STELLAR_TREASURY_PUBLIC'),
    secret: getEnv('TREASURY_SECRET_KEY') || getEnv('STELLAR_TREASURY_SECRET'),
  },
  escrow: {
    public: getEnv('ESCROW_PUBLIC_KEY') || getEnv('STELLAR_ESCROW_PUBLIC'),
    secret: getEnv('ESCROW_SECRET_KEY') || getEnv('STELLAR_ESCROW_SECRET'),
  },
  vendorSettlement: {
    public: getEnv('VENDOR_SETTLEMENT_PUBLIC_KEY') || getEnv('STELLAR_VENDOR_SETTLEMENT_PUBLIC'),
    secret: getEnv('VENDOR_SETTLEMENT_SECRET_KEY') || getEnv('STELLAR_VENDOR_SETTLEMENT_SECRET'),
  },
  revenue: {
    public: getEnv('REVENUE_PUBLIC_KEY') || getEnv('STELLAR_REVENUE_PUBLIC'),
    secret: getEnv('REVENUE_SECRET_KEY') || getEnv('STELLAR_REVENUE_SECRET'),
  },
  auditReserve: {
    public: getEnv('STELLAR_AUDIT_RESERVE_PUBLIC') || getEnv('AUDIT_RESERVE_PUBLIC_KEY'),
    secret: getEnv('STELLAR_AUDIT_RESERVE_SECRET') || getEnv('AUDIT_RESERVE_SECRET_KEY'),
  },
  feeReserve: {
    public: getEnv('STELLAR_FEE_RESERVE_PUBLIC') || getEnv('FEE_RESERVE_PUBLIC_KEY'),
    secret: getEnv('STELLAR_FEE_RESERVE_SECRET') || getEnv('FEE_RESERVE_SECRET_KEY'),
  }
};

// Check if critical platform secrets are configured
Object.entries(platformWallets).forEach(([name, keys]) => {
  if (!keys.public || !keys.secret) {
    console.error(`❌ CRITICAL CONFIG WARNING: Platform Stellar key "${name}" is missing in .env`);
  }
});

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
 * Burn tokens/Redeem on Cash Out: Transfer from VENDOR_SETTLEMENT to TREASURY (or back to Issuer)
 */
async function moveVendorToTreasury(amountKes) {
  return performPlatformTransfer(
    platformWallets.vendorSettlement.secret,
    platformWallets.treasury.public,
    amountKes,
    `Redeem Tokens on Withdrawal: Vendor Settlement -> Treasury`
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
  platformWallets,
  NT,
  NUTRITOKEN_CODE
};
