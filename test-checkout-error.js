const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Wallet = require('./models/Wallet');
const Cart = require('./models/Cart');
const stellarService = require('./services/stellarService');

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    const studentWallet = await Wallet.findOne({ walletType: 'student' }).select('+stellarSecretKey');
    const destinationPK = stellarService.platformKey ? stellarService.platformKey.publicKey() : null;
    console.log("Student PK:", studentWallet.stellarPublicKey);
    console.log("Destination PK:", destinationPK);

    const subtotalKes = 100; // Mock subtotal
    console.log(`Sending ${subtotalKes} KES from Student to Destination`);

    try {
      const tx = await stellarService.makePayment(studentWallet.stellarSecretKey, destinationPK, subtotalKes);
      console.log("Success Tx:", tx.hash);
    } catch (paymentErr) {
      if (paymentErr.response && paymentErr.response.data) {
        console.error("Stellar payment failed data:", JSON.stringify(paymentErr.response.data.extras, null, 2));
      } else {
        console.error("Stellar payment failed unknown:", paymentErr);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

run();
