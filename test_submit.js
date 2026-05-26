const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
require('dotenv').config();

function getEnv(key, defaultValue = "") {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.replace(/['"]/g, "").trim();
}

const HORIZON_URL = getEnv('HORIZON_URL', 'https://horizon-testnet.stellar.org');
const NETWORK_PASSPHRASE = getEnv('NETWORK_PASSPHRASE', 'Test SDF Network ; October 2015');

const server = new Horizon.Server(HORIZON_URL);

async function run() {
  const secret = getEnv('TREASURY_SECRET_KEY');
  const pair = Keypair.fromSecret(secret);
  console.log("Account:", pair.publicKey());
  
  try {
    const account = await server.loadAccount(pair.publicKey());
    console.log("Account loaded. Seq:", account.sequence);
    
    // Build a simple self-payment or bump sequence or set options to test signature
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(Operation.payment({
        destination: pair.publicKey(),
        asset: Asset.native(),
        amount: "0.0000100"
      }))
      .setTimeout(0)
      .build();
      
    tx.sign(pair);
    console.log("Tx signed. Submitting...");
    
    const res = await server.submitTransaction(tx);
    console.log("✅ Success! Tx Hash:", res.hash);
  } catch (err) {
    console.error("❌ Submission failed!");
    if (err.response && err.response.data) {
      console.error("  Stellar Extras:", JSON.stringify(err.response.data.extras || err.response.data, null, 2));
    } else {
      console.error("  Error message:", err.message);
    }
  }
}

run();
