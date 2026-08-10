const StellarSdk = require('stellar-sdk');
const fs = require('fs');
const path = require('path');

const walletNames = [
  "ISSUER",
  "TREASURY",
  "ESCROW",
  "VENDOR_SETTLEMENT",
  "REVENUE",
  "AUDIT_RESERVE",
  "FEE_RESERVE",
];

const wallets = {};

console.log("\n========================================");
console.log("Generating NutriPay Mainnet Wallets");
console.log("========================================\n");

walletNames.forEach((name) => {
  const pair = StellarSdk.Keypair.random();

  wallets[name] = {
    publicKey: pair.publicKey(),
    secretKey: pair.secret(),
  };

  console.log(`${name}`);
  console.log(`Public : ${pair.publicKey()}`);
  console.log(`Secret : ${pair.secret()}`);
  console.log("---------------------------------------");
});

const outputPath = path.join(__dirname, "mainnet-wallets.json");

fs.writeFileSync(
  outputPath,
  JSON.stringify(wallets, null, 2)
);

console.log(`\nWallets saved to:\n${outputPath}`);
console.log("\nIMPORTANT:");
console.log("Move this file to secure offline storage.");
console.log("Never commit it to Git.");
