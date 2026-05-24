const StellarSdk = require('stellar-sdk');
const { Horizon, Keypair, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('stellar-sdk');
require('dotenv').config();

// Initialize Stellar Server (Testnet)
const server = new Horizon.Server('https://horizon-testnet.stellar.org');

// Platform Keypairs
const platformWallets = {
  issuer: {
    public: process.env.STELLAR_ISSUER_PUBLIC,
    secret: process.env.STELLAR_ISSUER_SECRET,
  },
  treasury: {
    public: process.env.STELLAR_TREASURY_PUBLIC,
    secret: process.env.STELLAR_TREASURY_SECRET,
  },
  escrow: {
    public: process.env.STELLAR_ESCROW_PUBLIC,
    secret: process.env.STELLAR_ESCROW_SECRET,
  },
  vendorSettlement: {
    public: process.env.STELLAR_VENDOR_SETTLEMENT_PUBLIC,
    secret: process.env.STELLAR_VENDOR_SETTLEMENT_SECRET,
  },
  revenue: {
    public: process.env.STELLAR_REVENUE_PUBLIC,
    secret: process.env.STELLAR_REVENUE_SECRET,
  }
};

// Check if critical platform secrets are configured
Object.entries(platformWallets).forEach(([name, keys]) => {
  if (!keys.public || !keys.secret) {
    console.error(`❌ CRITICAL CONFIG WARNING: Platform Stellar key ${name} is missing in .env`);
  }
});

// Fixed Exchange Rate: 1 KES = 0.05 XLM (Testnet fixed rate for demo)
const EXCHANGE_RATE_KES_TO_XLM = 0.05;

function KES_to_XLM(kesAmount) {
  const amount = parseFloat(kesAmount) * EXCHANGE_RATE_KES_TO_XLM;
  let strAmount = amount.toFixed(7);
  // Remove trailing zeros and possible trailing dot
  strAmount = strAmount.replace(/0+$/, '').replace(/\.$/, '');
  return strAmount || "0";
}

/**
 * Perform a generic payment between platform accounts
 */
async function performPlatformTransfer(sourceSecret, destinationPublic, amountKES, description = "") {
  try {
    const xlmAmount = KES_to_XLM(amountKES);
    console.log(`[Stellar Platform Settlement] Translating: ${amountKES} KES -> ${xlmAmount} XLM. Desc: ${description}`);

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
        destination: destinationPublic,
        asset: Asset.native(),
        amount: xlmAmount
      }))
      .setTimeout(0)
      .build();

    transaction.sign(sourceKey);

    const result = await server.submitTransaction(transaction);
    console.log(`✅ Stellar settlement success! Tx Hash: ${result.hash}`);
    return result.hash;
  } catch (error) {
    if (error.response && error.response.data) {
      console.error("❌ Stellar Platform Transfer Failed:", JSON.stringify(error.response.data.extras || error.response.data, null, 2));
    } else {
      console.error("❌ Stellar Platform Transfer Failed:", error.message || error);
    }
    throw error;
  }
}

/**
 * Step 2: Settle lock amount from Treasury to Escrow
 */
async function settleToEscrow(amountKes) {
  return performPlatformTransfer(
    platformWallets.treasury.secret,
    platformWallets.escrow.public,
    amountKes,
    "Settle Treasury to Escrow (Subscription Lock)"
  );
}

/**
 * Step 3a: Release daily payout from Escrow to Vendor Settlement
 */
async function releaseVendorSettlement(amountKes) {
  return performPlatformTransfer(
    platformWallets.escrow.secret,
    platformWallets.vendorSettlement.public,
    amountKes,
    "Release Escrow to Vendor Settlement"
  );
}

/**
 * Step 3b: Record platform commission from Escrow to Revenue
 */
async function recordRevenue(amountKes) {
  return performPlatformTransfer(
    platformWallets.escrow.secret,
    platformWallets.revenue.public,
    amountKes,
    "Record Commission Escrow to Platform Revenue"
  );
}

/**
 * Step 4: Refund/Reverse from Escrow back to Treasury
 */
async function reverseSettlement(amountKes) {
  return performPlatformTransfer(
    platformWallets.escrow.secret,
    platformWallets.treasury.public,
    amountKes,
    "Reverse Settlement Escrow to Treasury (Refund)"
  );
}

module.exports = {
  settleToEscrow,
  releaseVendorSettlement,
  recordRevenue,
  reverseSettlement,
  platformWallets,
  KES_to_XLM
};
