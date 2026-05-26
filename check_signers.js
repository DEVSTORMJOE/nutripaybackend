const StellarSdk = require('stellar-sdk');
const { Horizon } = require('stellar-sdk');
require('dotenv').config();

// Helper to safely fetch environment variables and strip any potential surrounding quotes
function getEnv(key, defaultValue = "") {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.replace(/['"]/g, "").trim();
}

const HORIZON_URL = getEnv('HORIZON_URL', 'https://horizon-testnet.stellar.org');
const server = new Horizon.Server(HORIZON_URL);

const platformPublics = {
  issuer: getEnv('ISSUER_PUBLIC_KEY') || getEnv('STELLAR_ISSUER_PUBLIC'),
  treasury: getEnv('TREASURY_PUBLIC_KEY') || getEnv('STELLAR_TREASURY_PUBLIC'),
  escrow: getEnv('ESCROW_PUBLIC_KEY') || getEnv('STELLAR_ESCROW_PUBLIC'),
  vendorSettlement: getEnv('VENDOR_SETTLEMENT_PUBLIC_KEY') || getEnv('STELLAR_VENDOR_SETTLEMENT_PUBLIC'),
  revenue: getEnv('REVENUE_PUBLIC_KEY') || getEnv('STELLAR_REVENUE_PUBLIC')
};

async function check() {
  for (const [name, pub] of Object.entries(platformPublics)) {
    try {
      console.log(`\nAccount: ${name} (${pub})`);
      const account = await server.loadAccount(pub);
      console.log(`  Sequence: ${account.sequence}`);
      console.log(`  Thresholds:`, account.thresholds);
      console.log(`  Signers:`);
      account.signers.forEach(s => {
        console.log(`    - Key: ${s.key}, Weight: ${s.weight}, Type: ${s.type}`);
      });
    } catch (err) {
      console.log(`  Error loading account: ${err.message}`);
    }
  }
}

check();
