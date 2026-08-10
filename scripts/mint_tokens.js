const { Horizon, Keypair, TransactionBuilder, Operation, Asset, BASE_FEE } = require('stellar-sdk');
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
  const issuerSecret = getEnv('STELLAR_ISSUER_SECRET');
  const treasuryPublic = getEnv('STELLAR_TREASURY_PUBLIC');
  const issuerPair = Keypair.fromSecret(issuerSecret);
  
  console.log("Issuer Public Key:", issuerPair.publicKey());
  console.log("Treasury Public Key:", treasuryPublic);
  
  const nutriToken = new Asset("NT", issuerPair.publicKey());

  try {
    const account = await server.loadAccount(issuerPair.publicKey());
    console.log("Issuer account loaded. Sequence:", account.sequence);
    
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(Operation.payment({
        destination: treasuryPublic,
        asset: nutriToken,
        amount: "200000.0000000" // Mint and pay 200,000 NT to Treasury
      }))
      .setTimeout(0)
      .build();
      
    tx.sign(issuerPair);
    console.log("Transaction signed. Submitting to Horizon...");
    
    const res = await server.submitTransaction(tx);
    console.log("✅ Success! Custom NT Tokens minted and transferred to Treasury!");
    console.log("Tx Hash:", res.hash);
  } catch (err) {
    console.error("❌ Minting failed!");
    if (err.response && err.response.data) {
      console.error("Stellar Extras:", JSON.stringify(err.response.data.extras || err.response.data, null, 2));
    } else {
      console.error("Error message:", err.message);
    }
  }
}

run();
