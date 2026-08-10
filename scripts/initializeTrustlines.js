const mongoose = require('mongoose');
const stellarTreasuryService = require('../services/stellarTreasuryService');
require('dotenv').config();

const { IS_TESTNET, FRIENDBOT_URL } = require('../config/stellarConfig');

async function fundAccount(publicKey, name) {
  if (!IS_TESTNET) {
    console.log(`ℹ️  Running on Mainnet. Friendbot is disabled. Skipping automated funding for "${name}" (${publicKey}). Ensure account is pre-funded with XLM.`);
    return;
  }

  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  console.log(`🌐 Funding platform account "${name}" (${publicKey}) via Friendbot...`);
  
  try {
    const response = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
    if (response.ok) {
      console.log(`✅ Friendbot successfully funded "${name}" account!`);
      // Wait 3 seconds to ensure ledger consensus
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log(`ℹ️  Friendbot response status ${response.status} for "${name}". The account is likely already funded.`);
    }
  } catch (e) {
    console.warn(`⚠️ Friendbot funding failed for "${name}": ${e.message}`);
  }
}

async function initialize() {
  console.log("\n=======================================================================");
  console.log("🛠️  NUTRIPAY TRUSTLINE & STELLAR ACCOUNT INITIALIZER");
  console.log("=======================================================================");
  
  const wallets = stellarTreasuryService.platformWallets;

  // 1. Fund the accounts via Friendbot first to activate them on Stellar
  const accountsToFund = [
    { key: wallets.issuer, name: 'Issuer' },
    { key: wallets.treasury, name: 'Treasury' },
    { key: wallets.escrow, name: 'Escrow' },
    { key: wallets.vendorSettlement, name: 'Vendor Settlement' },
    { key: wallets.revenue, name: 'Revenue' }
  ];

  for (const acc of accountsToFund) {
    if (acc.key.public) {
      await fundAccount(acc.key.public, acc.name);
    }
  }

  console.log("\n🔗 establishing Trustlines for the custom NutriToken (NT) asset...");
  console.log("-----------------------------------------------------------------------");

  // 2. Establish trustlines for all platform wallets (excluding the Issuer itself)
  const trustlinesToCreate = [
    { key: wallets.treasury, name: 'Treasury' },
    { key: wallets.escrow, name: 'Escrow' },
    { key: wallets.vendorSettlement, name: 'Vendor Settlement' },
    { key: wallets.revenue, name: 'Revenue' }
  ];

  for (const acc of trustlinesToCreate) {
    if (acc.key.secret) {
      try {
        console.log(`Establishing NT trustline for "${acc.name}"...`);
        const txHash = await stellarTreasuryService.createTrustline(acc.key.secret);
        if (txHash === 'already_exists') {
          console.log(`✅ Trustline already verified for "${acc.name}".`);
        } else {
          console.log(`✅ Trustline established for "${acc.name}". Tx: ${txHash}`);
        }
      } catch (err) {
        console.error(`❌ Failed to establish trustline for "${acc.name}":`, err.message);
      }
    }
  }

  console.log("=======================================================================\n");
  process.exit(0);
}

initialize();
