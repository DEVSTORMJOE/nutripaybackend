const Transaction = require('../models/Transaction');
const queueService = require('./queueService');
const cron = require('node-cron');

/**
 * Scans MongoDB for any Transaction with settlementStatus === 'failed'
 * and pushes them to the Queue Service for safe, self-healing processing.
 */
async function retryFailedSettlements() {
  console.log("[Reconciliation Worker] Starting failed settlements reconciliation job...");
  
  try {
    const failedTxs = await Transaction.find({ settlementStatus: 'failed' }).limit(50);
    
    if (failedTxs.length === 0) {
      console.log("[Reconciliation Worker] No failed settlements found. System is in sync.");
      return { retried: 0, successful: 0 };
    }

    console.log(`[Reconciliation Worker] Found ${failedTxs.length} failed transactions. Enqueuing for execution...`);

    let enqueuedCount = 0;

    for (let tx of failedTxs) {
      try {
        console.log(`[Reconciliation Worker] Enqueuing transaction ${tx.transactionId} (${tx.transactionCategory}) for retry.`);
        
        // Mark as pending first so the cron won't select it again if it runs before completion
        tx.settlementStatus = 'pending';
        await tx.save();

        await queueService.addStellarJob(tx.transactionCategory, tx._id, {
          amountKES: parseFloat(tx.amountKES ? tx.amountKES.toString() : '0')
        });

        enqueuedCount++;
      } catch (err) {
        console.error(`[Reconciliation Worker] Failed to enqueue transaction ${tx.transactionId}: ${err.message}`);
        // Reset state to failed so it can be picked up later
        tx.settlementStatus = 'failed';
        await tx.save();
      }
    }

    console.log(`[Reconciliation Worker] Reconciliation job finished. Enqueued: ${enqueuedCount}/${failedTxs.length}`);
    return { retried: failedTxs.length, enqueued: enqueuedCount };

  } catch (error) {
    console.error("[Reconciliation Worker] Error during failed settlements reconciliation job:", error);
    throw error;
  }
}

// Automatically schedule the reconciliation job once a day in production (running at midnight)
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 0 * * *', async () => {
    try {
      await retryFailedSettlements();
    } catch (e) {
      console.error("Scheduled reconciliation job failed:", e);
    }
  });
}

module.exports = {
  retryFailedSettlements
};
