const StellarSdk = require('stellar-sdk');
const { Keypair } = require('stellar-sdk');
require('dotenv').config();

function getEnv(key, defaultValue = "") {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.replace(/['"]/g, "").trim();
}

const HORIZON_URL = getEnv('HORIZON_URL', 'https://horizon-testnet.stellar.org');
const NETWORK_PASSPHRASE = getEnv('NETWORK_PASSPHRASE', 'Test SDF Network ; October 2015');

console.log("Loaded CONFIG:");
console.log("  HORIZON_URL:", HORIZON_URL);
console.log("  NETWORK_PASSPHRASE:", NETWORK_PASSPHRASE);
console.log("  Is matching Testnet passphrase standard:", NETWORK_PASSPHRASE === 'Test SDF Network ; October 2015');

const platformWallets = {
  issuer: {
    public: process.env.ISSUER_PUBLIC_KEY,
    secret: process.env.ISSUER_SECRET_KEY,
  },
  treasury: {
    public: process.env.TREASURY_PUBLIC_KEY,
    secret: process.env.TREASURY_SECRET_KEY,
  },
  escrow: {
    public: process.env.ESCROW_PUBLIC_KEY,
    secret: process.env.ESCROW_SECRET_KEY,
  },
  vendorSettlement: {
    public: process.env.VENDOR_SETTLEMENT_PUBLIC_KEY,
    secret: process.env.VENDOR_SETTLEMENT_SECRET_KEY,
  },
  revenue: {
    public: process.env.REVENUE_PUBLIC_KEY,
    secret: process.env.REVENUE_SECRET_KEY,
  }
};

Object.entries(platformWallets).forEach(([name, keys]) => {
  if (!keys.secret) {
    console.log(`❌ ${name}: Secret key is missing`);
    return;
  }
  try {
    const pair = Keypair.fromSecret(keys.secret);
    const computedPub = pair.publicKey();
    if (computedPub === keys.public) {
      console.log(`✅ ${name}: Matches! ${computedPub}`);
    } else {
      console.log(`❌ ${name}: MISMATCH!`);
      console.log(`   Configured Public: ${keys.public}`);
      console.log(`   Computed Public:   ${computedPub}`);
    }
  } catch (err) {
    console.log(`❌ ${name}: Invalid secret key! ${err.message}`);
  }
});
