const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  debitWallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: false
  },
  creditWallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: false
  },
  amountKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  transactionId: {
    type: String,
    required: true
  },
  reference: {
    type: String,
    default: ""
  },
  ledgerType: {
    type: String,
    enum: ['deposit', 'withdrawal', 'transfer', 'escrow_lock', 'escrow_release', 'commission', 'refund'],
    required: true
  }
}, { timestamps: true });

const LedgerEntry = mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerEntrySchema);
module.exports = LedgerEntry;
