const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('./stellarTreasuryService');
const cron = require('node-cron');

/**
 * Scans MongoDB for any Transaction with settlementStatus === 'failed'
 * and attempts to re-execute their corresponding on-chain Stellar operations.
 */
async function retryFailedSettlements() {
  console.log("[Reconciliation Worker] Starting failed Stellar settlements retry job...");
  
  try {
    const failedTxs = await Transaction.find({ settlementStatus: 'failed' }).limit(50);
    
    if (failedTxs.length === 0) {
      console.log("[Reconciliation Worker] No failed settlements found. System is in sync.");
      return { retried: 0, successful: 0 };
    }

    console.log(`[Reconciliation Worker] Found ${failedTxs.length} failed transactions to retry.`);

    let successfulCount = 0;

    for (let tx of failedTxs) {
      try {
        console.log(`[Reconciliation Worker] Retrying transaction ${tx.transactionId} (${tx.transactionCategory}) for amount ${tx.amountKES} KES...`);
        
        let newTxHash = "";
        
        switch (tx.transactionCategory) {
          case 'deposit':
          case 'mpesa_direct_order':
            newTxHash = await stellarTreasuryService.mintNT(tx.amountKES);
            break;
            
          case 'subscription_lock':
            newTxHash = await stellarTreasuryService.settleToEscrow(tx.amountKES);
            break;
            
          case 'escrow_release':
            newTxHash = await stellarTreasuryService.releaseVendorSettlement(tx.amountKES);
            break;
            
          case 'commission':
            newTxHash = await stellarTreasuryService.recordRevenue(tx.amountKES);
            break;
            
          case 'refund':
            newTxHash = await stellarTreasuryService.reverseSettlement(tx.amountKES);
            break;
            
          case 'withdrawal':
            newTxHash = await stellarTreasuryService.moveVendorToTreasury(tx.amountKES);
            break;
            
          default:
            console.warn(`[Reconciliation Worker] Unknown or unhandled category "${tx.transactionCategory}" for transaction ${tx._id}. Skipping.`);
            continue;
        }

        if (newTxHash) {
          tx.stellarTxHash = newTxHash;
          tx.settlementStatus = 'synced';
          await tx.save();
          successfulCount++;
          console.log(`[Reconciliation Worker] Successfully synced transaction ${tx.transactionId}! Hash: ${newTxHash}`);
        }

      } catch (err) {
        console.error(`[Reconciliation Worker] Retry failed for transaction ${tx.transactionId}: ${err.message}`);
      }
    }

    console.log(`[Reconciliation Worker] Retry job finished. Retried: ${failedTxs.length}, Successfully Synced: ${successfulCount}`);
    return { retried: failedTxs.length, successful: successfulCount };

  } catch (error) {
    console.error("[Reconciliation Worker] Error during failed settlements retry job:", error);
    throw error;
  }
}

// Automatically schedule the retry job every hour in production
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 * * * *', async () => {
    try {
      await retryFailedSettlements();
    } catch (e) {
      console.error("Scheduled failed settlements retry job failed:", e);
    }
  });
}

module.exports = {
  retryFailedSettlements
};
