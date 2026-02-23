const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  stellarPublicKey: {
    type: String,
    required: true,
    unique: true
  },
  // WARNING: Storing secret key in DB is for prototype/hackathon only.
  // In production, use a secure vault or proper non-custodial wallet management.
  stellarSecretKey: {
    type: String,
    select: false // Do not return by default
  },
  balance: {
    type: Number,
    default: 0
  },
  walletType: {
    type: String,
    enum: ['student', 'sponsor', 'vendor', 'admin', 'delivery'],
    required: true
  }
}, { timestamps: true });

const Wallet = mongoose.model('Wallet', walletSchema);
module.exports = Wallet;
