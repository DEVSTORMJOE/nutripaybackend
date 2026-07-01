const LedgerEntry = require('../models/LedgerEntry');

/**
 * Record a double-entry ledger item in the system.
 * @param {Object} entry - Ledger entry details.
 * @param {mongoose.ClientSession} [session] - Optional transaction session.
 */
async function recordLedgerEntry({ debitWallet, creditWallet, amountKES, transactionId, reference, ledgerType }, session = null) {
  const doc = {
    debitWallet: debitWallet || null,
    creditWallet: creditWallet || null,
    amountKES,
    transactionId,
    reference,
    ledgerType
  };

  const opts = session ? { session } : {};
  const entries = await LedgerEntry.create([doc], opts);
  return entries[0];
}

module.exports = {
  recordLedgerEntry
};
