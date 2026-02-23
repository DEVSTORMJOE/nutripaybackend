const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
require('dotenv').config();

// Initialize Stellar Server (Testnet)
const server = new Horizon.Server('https://horizon-testnet.stellar.org');

// Platform Key (Admin)
const platformKey = process.env.PLATFORM_SECRET_KEY
  ? Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY)
  : null;

if (!platformKey) {
  console.error("❌ CRITICAL: PLATFORM_SECRET_KEY is missing from .env");
}

/**
 * Creates a restricted Student Wallet
 * Returns keys to be stored in Wallet model
 */
async function createWallet() {
  try {
    const pair = Keypair.random();

    // In testnet, we can fund with friendbot
    // In mainnet, this would need a funding transaction from the platform wallet
    try {
      await fetch(`https://friendbot.stellar.org?addr=${pair.publicKey()}`);
    } catch (e) {
      console.warn("Friendbot funding failed or timed out", e);
    }

    // Set options to assign platform as signer (multisig / custodial control)
    // For now, we return the pair, the controller will handle DB storage
    return {
      publicKey: pair.publicKey(),
      secret: pair.secret()
    };
  } catch (error) {
    console.error("Error creating wallet:", error);
    throw error;
  }
}

/**
 * Fund a wallet (e.g. Sponsor -> Student)
 * Currently just a payment, but semantically distinct
 */
async function fundWallet(sourceSecret, destinationPublicKey, amount) {
  return makePayment(sourceSecret, destinationPublicKey, amount);
}

/**
 * Generic Payment
 */
async function makePayment(sourceSecret, destinationPublicKey, amount) {
  try {
    const sourceKey = Keypair.fromSecret(sourceSecret);
    const account = await server.loadAccount(sourceKey.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET
    })
      .addOperation(Operation.payment({
        destination: destinationPublicKey,
        asset: Asset.native(),
        amount: amount.toString()
      }))
      .setTimeout(30)
      .build();

    transaction.sign(sourceKey);
    // If multisig is set up, platformKey might also need to sign
    // transaction.sign(platformKey);

    const result = await server.submitTransaction(transaction);
    return result;
  } catch (error) {
    console.error("Payment failed:", error);
    throw error;
  }
}

async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find(b => b.asset_type === 'native');
    return native ? native.balance : '0';
  } catch (error) {
    console.error("Error fetching balance:", error);
    return '0';
  }
}

module.exports = {
  createWallet,
  fundWallet,
  makePayment,
  getBalance,
  platformKey
};
