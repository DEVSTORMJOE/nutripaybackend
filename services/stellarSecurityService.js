const StellarSdk = require('stellar-sdk');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const server = new StellarSdk.Horizon.Server(HORIZON_URL);
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;

const NT_CODE = process.env.NUTRITOKEN_CODE || 'NT';

// Platform Wallets configuration from .env
const platformWallets = {
  issuer: {
    public: process.env.STELLAR_ISSUER_PUBLIC || process.env.ISSUER_PUBLIC_KEY,
    secret: process.env.STELLAR_ISSUER_SECRET || process.env.ISSUER_SECRET_KEY
  },
  treasury: {
    public: process.env.STELLAR_TREASURY_PUBLIC || process.env.TREASURY_PUBLIC_KEY,
    secret: process.env.STELLAR_TREASURY_SECRET || process.env.TREASURY_SECRET_KEY
  },
  escrow: {
    public: process.env.STELLAR_ESCROW_PUBLIC || process.env.ESCROW_PUBLIC_KEY,
    secret: process.env.STELLAR_ESCROW_SECRET || process.env.ESCROW_SECRET_KEY
  },
  vendorSettlement: {
    public: process.env.STELLAR_VENDOR_SETTLEMENT_PUBLIC || process.env.VENDOR_SETTLEMENT_PUBLIC_KEY,
    secret: process.env.STELLAR_VENDOR_SETTLEMENT_SECRET || process.env.VENDOR_SETTLEMENT_SECRET_KEY
  },
  revenue: {
    public: process.env.STELLAR_REVENUE_PUBLIC || process.env.REVENUE_PUBLIC_KEY,
    secret: process.env.STELLAR_REVENUE_SECRET || process.env.REVENUE_SECRET_KEY
  }
};

const NT = new StellarSdk.Asset(NT_CODE, platformWallets.issuer.public);

/**
 * 1. Configure Issuer Account Flags: Set AUTH_REQUIRED and AUTH_REVOCABLE.
 * This locks the asset NT down so that only accounts approved by the issuer can hold it.
 */
async function configureIssuerFlags() {
  const issuerKey = StellarSdk.Keypair.fromSecret(platformWallets.issuer.secret);
  const issuerAccount = await server.loadAccount(issuerKey.publicKey());

  // Check if flags are already set
  const hasAuthRequired = issuerAccount.flags.auth_required;
  const hasAuthRevocable = issuerAccount.flags.auth_revocable;

  if (hasAuthRequired && hasAuthRevocable) {
    console.log("✅ Issuer authorization flags already configured.");
    return { status: "already_configured", hasAuthRequired, hasAuthRevocable };
  }

  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(StellarSdk.Operation.setOptions({
      setFlags: StellarSdk.xdr.AccountFlags.authRequiredFlag().value | StellarSdk.xdr.AccountFlags.authRevocableFlag().value
    }))
    .setTimeout(StellarSdk.TimeoutInfinite)
    .build();

  tx.sign(issuerKey);
  const result = await server.submitTransaction(tx);
  console.log(`✅ Issuer authorization flags configured! Tx Hash: ${result.hash}`);
  return { status: "configured", txHash: result.hash };
}

/**
 * 2. Check Trustline for an account.
 * Returns: { exists: boolean, authorized: boolean, balance: string }
 */
async function checkTrustline(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const balance = account.balances.find(
      b => b.asset_code === NT_CODE && b.asset_issuer === platformWallets.issuer.public
    );
    if (!balance) {
      return { exists: false, authorized: false, balance: "0" };
    }
    return {
      exists: true,
      authorized: balance.is_authorized || balance.is_authorized_to_maintain_liabilities,
      balance: balance.balance
    };
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return { exists: false, authorized: false, balance: "0", unfunded: true };
    }
    throw err;
  }
}

/**
 * 3. Create trustline for a platform custodial wallet.
 */
async function createTrustline(secretKey) {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const account = await server.loadAccount(keypair.publicKey());

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(StellarSdk.Operation.changeTrust({
      asset: NT,
      limit: "922337203685.4775807"
    }))
    .setTimeout(StellarSdk.TimeoutInfinite)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * 4. Approve trustline (authorize an account to hold NT).
 */
async function approveTrustline(targetPublicKey) {
  const issuerKey = StellarSdk.Keypair.fromSecret(platformWallets.issuer.secret);
  const issuerAccount = await server.loadAccount(issuerKey.publicKey());

  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(StellarSdk.Operation.setTrustLineFlags({
      trustor: targetPublicKey,
      asset: NT,
      flags: {
        authorized: true
      }
    }))
    .setTimeout(StellarSdk.TimeoutInfinite)
    .build();

  tx.sign(issuerKey);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * 5. Revoke trustline (freeze holdings, emergency revoke).
 */
async function revokeTrustline(targetPublicKey) {
  const issuerKey = StellarSdk.Keypair.fromSecret(platformWallets.issuer.secret);
  const issuerAccount = await server.loadAccount(issuerKey.publicKey());

  const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(StellarSdk.Operation.setTrustLineFlags({
      trustor: targetPublicKey,
      asset: NT,
      flags: {
        authorized: false
      }
    }))
    .setTimeout(StellarSdk.TimeoutInfinite)
    .build();

  tx.sign(issuerKey);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * 6. Idempotently bootstrap platform trustlines for Treasury, Escrow, Vendor Settlement, and Revenue.
 */
async function bootstrapPlatformTrustlines() {
  const wallets = [
    { name: 'Treasury', secret: platformWallets.treasury.secret, public: platformWallets.treasury.public },
    { name: 'Escrow', secret: platformWallets.escrow.secret, public: platformWallets.escrow.public },
    { name: 'Vendor Settlement', secret: platformWallets.vendorSettlement.secret, public: platformWallets.vendorSettlement.public },
    { name: 'Revenue', secret: platformWallets.revenue.secret, public: platformWallets.revenue.public }
  ];

  const results = [];

  // Make sure issuer flags are configured first
  await configureIssuerFlags();

  for (const w of wallets) {
    console.log(`[Stellar Bootstrap] Checking wallet ${w.name} (${w.public})...`);
    
    // Check if account exists. If not funded, fund it using friendbot (in Testnet)
    try {
      await server.loadAccount(w.public);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log(`[Stellar Bootstrap] Account ${w.name} is unfunded. Funding via Friendbot...`);
        try {
          await axios.get(`https://friendbot.stellar.org?addr=${w.public}`);
          console.log(`[Stellar Bootstrap] Account ${w.name} successfully funded via Friendbot.`);
          // wait a small delay
          await new Promise(r => setTimeout(r, 2000));
        } catch (friendbotErr) {
          console.error(`[Stellar Bootstrap] Friendbot funding failed for ${w.name}:`, friendbotErr.message);
          results.push({ name: w.name, public: w.public, status: "friendbot_failed" });
          continue;
        }
      } else {
        throw err;
      }
    }

    const state = await checkTrustline(w.public);
    let trustlineCreated = false;
    let trustlineApproved = false;

    if (!state.exists) {
      console.log(`[Stellar Bootstrap] Creating trustline for ${w.name}...`);
      await createTrustline(w.secret);
      trustlineCreated = true;
    }

    // Check authorization flag
    const updatedState = await checkTrustline(w.public);
    if (!updatedState.authorized) {
      console.log(`[Stellar Bootstrap] Approving/Authorizing trustline for ${w.name}...`);
      await approveTrustline(w.public);
      trustlineApproved = true;
    }

    results.push({
      name: w.name,
      public: w.public,
      trustlineExisted: state.exists,
      trustlineCreated,
      authorizedExisted: state.authorized,
      authorizedCreated: trustlineApproved,
      balance: (await checkTrustline(w.public)).balance
    });
  }

  return results;
}

/**
 * 7. Fetch live Stellar status dashboard data.
 */
async function getSecurityStatus() {
  const wallets = [
    { name: 'Issuer', public: platformWallets.issuer.public },
    { name: 'Treasury', public: platformWallets.treasury.public },
    { name: 'Escrow', public: platformWallets.escrow.public },
    { name: 'Vendor Settlement', public: platformWallets.vendorSettlement.public },
    { name: 'Revenue', public: platformWallets.revenue.public }
  ];

  let issuerFlags = { auth_required: false, auth_revocable: false };
  try {
    const issuerAcc = await server.loadAccount(platformWallets.issuer.public);
    issuerFlags.auth_required = issuerAcc.flags.auth_required;
    issuerFlags.auth_revocable = issuerAcc.flags.auth_revocable;
  } catch (err) {
    console.error("Failed to load issuer account status:", err.message);
  }

  const reports = [];
  for (const w of wallets) {
    if (w.name === 'Issuer') {
      reports.push({
        name: w.name,
        publicKey: w.public,
        trustlineExists: true,
        authorized: true,
        balance: 'N/A'
      });
      continue;
    }

    try {
      const state = await checkTrustline(w.public);
      reports.push({
        name: w.name,
        publicKey: w.public,
        trustlineExists: state.exists,
        authorized: state.authorized,
        balance: state.balance,
        unfunded: state.unfunded || false
      });
    } catch (err) {
      reports.push({
        name: w.name,
        publicKey: w.public,
        trustlineExists: false,
        authorized: false,
        balance: 'Error',
        error: err.message
      });
    }
  }

  return {
    issuerFlags,
    wallets: reports,
    timestamp: new Date()
  };
}

module.exports = {
  platformWallets,
  configureIssuerFlags,
  checkTrustline,
  createTrustline,
  approveTrustline,
  revokeTrustline,
  bootstrapPlatformTrustlines,
  getSecurityStatus
};
