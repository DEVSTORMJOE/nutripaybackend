const mongoose = require('mongoose');
const Wallet = require('./models/Wallet');
const stellarService = require('./services/stellarService');
require('dotenv').config();

async function testCheckout() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // get student wallet
    const studentWallet = await Wallet.findOne({ walletType: 'student' }).select('+stellarSecretKey');
    let vendorWallet = await Wallet.findOne({ walletType: 'vendor' });
    
    let destPubKey = vendorWallet ? vendorWallet.stellarPublicKey : stellarService.platformKey.publicKey();
    
    console.log(`Student pub: ${studentWallet.stellarPublicKey}`);
    console.log(`Dest pub: ${destPubKey}`);
    
    // make payment of 200 KES
    console.log(`Trying to pay 200 KES...`);
    const tx = await stellarService.makePayment(studentWallet.stellarSecretKey, destPubKey, 200);
    console.log(`Success! TX: ${tx.hash}`);
    
  } catch(e) {
      if (e.response && e.response.data && e.response.data.extras) {
          require('fs').writeFileSync('test_checkout_result.json', JSON.stringify(e.response.data.extras, null, 2));
          console.log("Wrote error extras to test_checkout_result.json");
      } else {
          console.log(e.message);
      }
  } finally {
      process.exit(0);
  }
}
testCheckout();
