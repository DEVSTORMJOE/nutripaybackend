const StellarSdk = require('stellar-sdk');
const { Transaction } = require('stellar-sdk');

const xdr = 'AAAAAgAAAACz6mTzlnddIOxzaJXoHTdiD9kkEfmBNW5QxoOn88j4qgAAAGQAKZcIAAAABwAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAABgAAAAFOVAAAAAAAAP3RCu6H4TvEyZuFKYJKu5BTe1upqCOM4Wdw3EffvmS6f/////////8AAAAAAAAAAfPI+KoAAABAWGppBeZAFwaTzYxyBVF9xMy3BdirjySKY8/9abHFQQ3WIyORkRDsPit4USi+OkLMfBAhFmiK9SRsY4n3c6TNAQ==';

try {
  const tx = new Transaction(xdr, 'Test SDF Network ; October 2015');
  console.log("Decoded successfully!");
  console.log("  Source account:", tx.source);
  console.log("  Sequence:", tx.sequence);
  console.log("  Fee:", tx.fee);
  console.log("  Operations count:", tx.operations.length);
  const op = tx.operations[0];
  console.log("  Operation type:", op.type);
  console.log("  Asset code:", op.asset.code);
  console.log("  Asset issuer:", op.asset.issuer);
  
  // Verify signature
  const sig = tx.signatures[0];
  console.log("  Signatures count:", tx.signatures.length);
  console.log("  Signature hint:", sig.hint().toString('hex'));
} catch (err) {
  console.error("Decoding failed:", err.message);
}
