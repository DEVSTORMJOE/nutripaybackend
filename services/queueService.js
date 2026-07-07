const { Queue } = require('bullmq');
const { getRedisClient, isRedisEnabled } = require('../config/redis');

let stellarQueue = null;

// Initialize BullMQ Queue if Redis is active
function initQueue() {
  if (isRedisEnabled() && !stellarQueue) {
    try {
      const queueName = process.env.STELLAR_QUEUE_NAME || 'stellar-transactions';
      stellarQueue = new Queue(queueName, {
        connection: getRedisClient(),
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000 // 5 seconds initial delay
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      });
      console.log("[Queue Service] BullMQ initialized successfully.");
    } catch (err) {
      console.error("[Queue Service] Failed to initialize BullMQ:", err);
    }
  }
}

// Fallback Custom Memory Queue for local/in-memory queueing
class MemoryQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async add(taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    this.running++;
    const { taskFn, resolve, reject } = this.queue.shift();
    
    // Execute task asynchronously
    taskFn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.running--;
        this.next();
      });
  }
}

const memoryQueue = new MemoryQueue(1); // Single worker process to avoid race conditions!

/**
 * Add a Stellar operation job to the queue
 * @param {string} category - e.g., 'deposit', 'subscription_lock', 'escrow_release', 'refund', 'withdrawal'
 * @param {string} transactionId - MongoDB Transaction record ID
 * @param {object} data - Extra details (e.g. amountKES)
 */
async function addStellarJob(category, transactionId, data = {}) {
  // Ensure queue is initialized if Redis became active
  initQueue();

  const jobPayload = { category, transactionId, ...data };

  if (isRedisEnabled() && stellarQueue) {
    try {
      const job = await stellarQueue.add(`${category}:${transactionId}`, jobPayload);
      console.log(`[Queue Service] Job successfully enqueued in BullMQ: ${job.id}`);
      return { type: 'bullmq', jobId: job.id };
    } catch (err) {
      console.error(`[Queue Service] Failed to queue job in BullMQ. Falling back to local queue:`, err.message);
    }
  }

  // Fallback inline/in-memory queue
  console.log(`[Queue Service] Running job in Fallback local memory queue: ${category}:${transactionId}`);
  
  // We trigger the worker logic directly in a non-blocking way
  // We import the worker function here dynamically to avoid circular references
  const { processStellarJob } = require('../workers/stellarQueueWorker');
  
  // Enqueue task into local queue
  memoryQueue.add(async () => {
    let attempts = 0;
    const maxAttempts = 5;
    let delay = 5000; // Start with 5 seconds

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`[Local Queue Worker] Attempt ${attempts}/${maxAttempts} for ${category}:${transactionId}`);
        await processStellarJob(jobPayload);
        console.log(`[Local Queue Worker] Successfully processed ${category}:${transactionId}`);
        break; // Success! Break out of retry loop
      } catch (error) {
        console.error(`[Local Queue Worker] Attempt ${attempts} failed for ${category}:${transactionId}: ${error.message}`);
        
        if (attempts >= maxAttempts) {
          console.error(`[Local Queue Worker] Max attempts reached for ${category}:${transactionId}. Job failed permanently.`);
          // Update transaction in DB to failed
          try {
            const Transaction = require('../models/Transaction');
            await Transaction.findByIdAndUpdate(transactionId, { $set: { settlementStatus: 'failed' } });
          } catch (dbErr) {
            console.error("[Local Queue Worker] Failed to mark transaction failed:", dbErr.message);
          }
          break;
        }

        // Wait before retrying (exponential backoff)
        console.log(`[Local Queue Worker] Waiting ${delay / 1000}s before retry...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // Double the delay
      }
    }
  }).catch(err => {
    console.error(`[Local Queue Worker] Fatal error in queue execution:`, err);
  });

  return { type: 'memory', status: 'enqueued' };
}

module.exports = {
  addStellarJob
};
