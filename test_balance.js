const mongoose = require('mongoose');
const Wallet = require('./models/Wallet');
const stellarService = require('./services/stellarService');
require('dotenv').config();

async function checkBalanceUpdate() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const wallet = await Wallet.findOne({ walletType: 'vendor' });
    if (!wallet) return console.log("No vendor wallet");
    
    console.log(`Original DB Balance: ${wallet.balance}`);
    
    const liveXlmBalance = await stellarService.getBalance(wallet.stellarPublicKey);
    console.log(`Live XLM Balance: ${liveXlmBalance}`);
    
    const liveKesBalance = stellarService.XLM_to_KES(liveXlmBalance);
    console.log(`Calculated KES (NT): ${liveKesBalance}`);
    
  } catch(e) {
      console.error(e);
  } finally {
      process.exit(0);
  }
}
checkBalanceUpdate();
