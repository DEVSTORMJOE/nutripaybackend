const StellarSdk = require('stellar-sdk');
const { TransactionBuilder, Keypair, Networks, Asset } = require('stellar-sdk');

console.log("Networks.TESTNET:", Networks.TESTNET);
console.log("Networks.PUBLIC:", Networks.PUBLIC);

// Create a dummy account
const pair = Keypair.random();
const dummyAccount = new StellarSdk.Account(pair.publicKey(), "1");

const builder = new TransactionBuilder(dummyAccount, {
  fee: "100",
  networkPassphrase: "Test SDF Network ; October 2015"
});

builder.addOperation(StellarSdk.Operation.payment({
  destination: pair.publicKey(),
  asset: Asset.native(),
  amount: "1.0"
}));

const tx = builder.setTimeout(0).build();
console.log("Built TX networkPassphrase:", tx.networkPassphrase);
