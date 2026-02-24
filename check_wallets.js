const mongoose = require('mongoose');
const Wallet = require('./models/Wallet');
const User = require('./models/User');
const stellarService = require('./services/stellarService');
require('dotenv').config();

async function check() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");
    
    // Get all wallets
    const wallets = await Wallet.find().select('+stellarSecretKey');
    for (const w of wallets) {
        console.log(`Wallet ${w.walletType} for User ${w.user}, balance: ${w.balance}, publicKey: ${w.stellarPublicKey}`);
        
        try {
            const xlmBalance = await stellarService.getBalance(w.stellarPublicKey);
            console.log(`  Stellar XLM Balance for ${w.stellarPublicKey}: ${xlmBalance}`);
        } catch(e) {
            console.log(`  Failed to get Stellar logic for ${w.stellarPublicKey}: ${e.message}`);
        }
    }
  } catch(e) {
      console.error(e);
  } finally {
      process.exit(0);
  }
}
check();
