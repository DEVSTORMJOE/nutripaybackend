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

// Exchange Rate Logic: 1 KES = 0.05 XLM (Testnet fixed rate for demo)
const EXCHANGE_RATE_KES_TO_XLM = 0.05;

function KES_to_XLM(kesAmount) {
  const amount = parseFloat(kesAmount) * EXCHANGE_RATE_KES_TO_XLM;
  // Stellar amounts must be string and have max 7 decimal places
  let strAmount = amount.toFixed(7);
  // Remove trailing zeros and possible trailing dot
  strAmount = strAmount.replace(/0+$/, '').replace(/\.$/, '');
  return strAmount || "0";
}

function XLM_to_KES(xlmAmount) {
  const amount = parseFloat(xlmAmount) / EXCHANGE_RATE_KES_TO_XLM;
  return amount.toFixed(2);
}

/**
 * Creates a restricted Student Wallet
 * Returns keys to be stored in Wallet model
 */
async function createWallet() {
  try {
    const pair = Keypair.random();

    console.log(`Requesting Friendbot funding for ${pair.publicKey()}`);
    // In testnet, we can fund with friendbot
    try {
      const response = await fetch(`https://friendbot.stellar.org?addr=${pair.publicKey()}`);
      if (!response.ok) {
        throw new Error(`Friendbot failed with status ${response.status}`);
      }
      await response.json(); // ensure it finishes
      console.log(`Friendbot funding successful for ${pair.publicKey()}`);
    } catch (e) {
      console.error("Friendbot funding failed or timed out:", e);
      throw new Error("Failed to fund new wallet on Stellar network.");
    }

    // Return the keys, the controller will handle DB storage
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
 * amount should be in KES
 */
async function fundWallet(sourceSecret, destinationPublicKey, amountKES) {
  return makePayment(sourceSecret, destinationPublicKey, amountKES);
}

/**
 * Generic Payment
 * amount should be in KES
 */
async function makePayment(sourceSecret, destinationPublicKey, amountKES) {
  try {
    const xlmAmount = KES_to_XLM(amountKES);
    console.log(`Translating Payment: ${amountKES} KES -> ${xlmAmount} XLM`);

    if (parseFloat(xlmAmount) <= 0) {
        throw new Error("Converted XLM amount is 0 or less");
    }

    const sourceKey = Keypair.fromSecret(sourceSecret);
    const account = await server.loadAccount(sourceKey.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET
    })
      .addOperation(Operation.payment({
        destination: destinationPublicKey,
        asset: Asset.native(),
        amount: xlmAmount
      }))
      .setTimeout(30)
      .build();

    transaction.sign(sourceKey);

    const result = await server.submitTransaction(transaction);
    return result;
  } catch (error) {
    if (error.response && error.response.data) {
        console.error("Payment failed with Stellar response:", JSON.stringify(error.response.data, null, 2));
    } else {
        console.error("Payment failed:", error);
    }
    throw error;
  }
}

/**
 * Fetch live Stellar balance and return in XLM (or KES if mapped logically, but standard is XLM).
 * Let's return raw XLM, and allow the controller to convert, 
 * OR return both KES and XLM. We'll return native balance string.
 */
async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find(b => b.asset_type === 'native');
    const xlmBalance = native ? native.balance : '0';
    return xlmBalance;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.warn(`Account ${publicKey} not found on network`);
    } else {
      console.error("Error fetching balance:", error);
    }
    return '0';
  }
}

module.exports = {
  createWallet,
  fundWallet,
  makePayment,
  getBalance,
  KES_to_XLM,
  XLM_to_KES,
  platformKey
};
