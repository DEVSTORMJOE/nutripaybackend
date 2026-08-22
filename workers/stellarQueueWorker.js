const { Worker } = require('bullmq');
const { getRedisClient, isRedisEnabled } = require('../config/redis');
const Transaction = require('../models/Transaction');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const connectDB = require('../config/db');
const dotenv = require('dotenv');

// Core task executor
async function processStellarJob(jobData) {
  const { category, transactionId, amountKES } = jobData;
  console.log(`[Stellar Worker] Processing job for Transaction ID: ${transactionId}, Category: ${category}`);

  let tx = null;
  if (require('mongoose').Types.ObjectId.isValid(transactionId)) {
    tx = await Transaction.findById(transactionId);
  }
  if (!tx) {
    tx = await Transaction.findOne({ transactionId: transactionId });
  }

  if (!tx) {
    console.warn(`[Stellar Worker] Transaction with ID ${transactionId} not found in database. Skipping job.`);
    return null;
  }

  // If already synced, skip execution
  if (tx.settlementStatus === 'synced' && tx.stellarTxHash) {
    console.log(`[Stellar Worker] Transaction ${transactionId} is already synced. Skipping.`);
    return tx.stellarTxHash;
  }

  const targetAmount = amountKES || parseFloat(tx.amountKES ? tx.amountKES.toString() : '0');
  if (targetAmount <= 0 || isNaN(targetAmount)) {
    throw new Error(`Invalid transaction amount: ${targetAmount} KES`);
  }

  let newTxHash = "";
  
  switch (category) {
    case 'deposit':
      newTxHash = await stellarTreasuryService.mintNT(targetAmount);
      break;

    case 'mpesa_direct_order':
      // Direct M-Pesa Quick Order: 1. Mint NT to Treasury, 2. Transfer Treasury -> Escrow
      console.log(`[Stellar Worker] Processing mpesa_direct_order for ${targetAmount} KES: Minting to Treasury & locking to Escrow...`);
      await stellarTreasuryService.mintNT(targetAmount);
      newTxHash = await stellarTreasuryService.settleToEscrow(targetAmount);
      break;
      
    case 'subscription_lock':
    case 'custom_order':
      newTxHash = await stellarTreasuryService.settleToEscrow(targetAmount);
      break;
      
    case 'escrow_release':
      newTxHash = await stellarTreasuryService.releaseVendorSettlement(targetAmount);
      break;
      
    case 'commission':
      newTxHash = await stellarTreasuryService.recordRevenue(targetAmount);
      break;
      
    case 'refund':
      newTxHash = await stellarTreasuryService.reverseSettlement(targetAmount);
      break;
      
    case 'withdrawal':
      newTxHash = await stellarTreasuryService.moveVendorToTreasury(targetAmount);
      break;
      
    default:
      throw new Error(`Unhandled transaction category for on-chain settlement: "${category}"`);
  }

  if (newTxHash) {
    tx.stellarTxHash = newTxHash;
    tx.settlementStatus = 'synced';
    await tx.save();
    console.log(`[Stellar Worker] Successfully processed transaction ${transactionId}. Hash: ${newTxHash}`);
    return newTxHash;
  } else {
    throw new Error(`Failed to generate a valid Stellar transaction hash for category "${category}"`);
  }
}

// Start BullMQ worker daemon if Redis is enabled
let bullWorker = null;

function startBullWorker() {
  if (isRedisEnabled() && !bullWorker) {
    try {
      const queueName = process.env.STELLAR_QUEUE_NAME || 'stellar-transactions';
      bullWorker = new Worker(queueName, async (job) => {
        await processStellarJob(job.data);
      }, {
        connection: getRedisClient(),
        concurrency: 1 // Sequential processing to prevent double-spending or account sequence conflicts on Stellar!
      });

      bullWorker.on('completed', (job) => {
        console.log(`[Stellar Worker] Job completed: ${job.id}`);
      });

      bullWorker.on('failed', (job, err) => {
        console.error(`[Stellar Worker] Job failed: ${job ? job.id : 'unknown'}. Error: ${err.message}`);
      });

      console.log("[Stellar Worker] BullMQ Worker started monitoring queue.");
    } catch (err) {
      console.error("[Stellar Worker] Failed to start BullMQ Worker:", err);
    }
  }
}

// Automatically start if loaded and Redis is ready
// Give connections a small delay to establish
setTimeout(() => {
  if (isRedisEnabled()) {
    startBullWorker();
  }
}, 3000);

// If run directly (e.g., node workers/stellarQueueWorker.js)
if (require.main === module) {
  dotenv.config();
  connectDB().then(() => {
    console.log("[Stellar Worker] DB connected in standalone mode. Initializing worker...");
    // Wait briefly for Redis connection
    setTimeout(() => {
      if (isRedisEnabled()) {
        startBullWorker();
      } else {
        console.log("[Stellar Worker] Redis is not active. Standalone worker will run in polling fallback.");
      }
    }, 2000);
  });
}

module.exports = {
  processStellarJob,
  startBullWorker
};
