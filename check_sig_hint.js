const StellarSdk = require('stellar-sdk');
const { Keypair, Transaction } = require('stellar-sdk');
require('dotenv').config();

const xdr = 'AAAAAgAAAACz6mTzlnddIOxzaJXoHTdiD9kkEfmBNW5QxoOn88j4qgAAAGQAKZcIAAAABwAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAABgAAAAFOVAAAAAAAAP3RCu6H4TvEyZuFKYJKu5BTe1upqCOM4Wdw3EffvmS6f/////////8AAAAAAAAAAfPI+KoAAABAWGppBeZAFwaTzYxyBVF9xMy3BdirjySKY8/9abHFQQ3WIyORkRDsPit4USi+OkLMfBAhFmiK9SRsY4n3c6TNAQ==';

const tx = new Transaction(xdr, 'Test SDF Network ; October 2015');
const signature = tx.signatures[0];
const hint = signature.hint().toString('hex');
console.log("Tx signature hint:", hint);

const treasurySecret = process.env.TREASURY_SECRET_KEY.replace(/['"]/g, "").trim();
const treasuryPair = Keypair.fromSecret(treasurySecret);
const treasuryHint = treasuryPair.signatureHint().toString('hex');
console.log("Treasury keypair hint:", treasuryHint);

console.log("Do hints match:", hint === treasuryHint);
