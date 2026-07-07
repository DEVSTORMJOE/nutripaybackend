// scripts/testInfrastructure.js
process.env.STELLAR_QUEUE_NAME = 'stellar-transactions-test';
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { isRedisEnabled } = require('../config/redis');
const cacheService = require('../services/cacheService');
const queueService = require('../services/queueService');
const Transaction = require('../models/Transaction');
const { startBullWorker } = require('../workers/stellarQueueWorker');

async function runTests() {
  console.log("==================================================");
  console.log("       NutriPay Infrastructure Test Script        ");
  console.log("==================================================");

  dotenv.config();
  await connectDB();

  // Wait a moment for Redis to establish connection
  console.log("Waiting 2s for Redis connection check...");
  await new Promise(r => setTimeout(r, 2000));

  const redisActive = isRedisEnabled();
  console.log(`Redis connection status: ${redisActive ? 'ACTIVE (Redis Mode)' : 'INACTIVE (Fallback Mode)'}`);

  if (redisActive) {
    console.log("Starting BullMQ worker for test execution...");
    startBullWorker();
  }

  // Test 1: Caching Set/Get/Delete
  console.log("\n--- Running Test 1: Cache Operations ---");
  const testKey = "test:infra:cache-key";
  const testVal = { success: true, timestamp: Date.now() };

  console.log(`Setting cache key "${testKey}"...`);
  await cacheService.set(testKey, testVal, 30);

  console.log(`Reading cache key "${testKey}"...`);
  const readVal = await cacheService.get(testKey);
  console.log("Cached value retrieved:", readVal);

  if (readVal && readVal.success === true) {
    console.log("✅ Caching GET/SET Successful!");
  } else {
    console.error("❌ Caching GET/SET Failed!");
  }

  console.log(`Deleting cache key "${testKey}"...`);
  await cacheService.del(testKey);
  const deletedVal = await cacheService.get(testKey);
  if (!deletedVal) {
    console.log("✅ Cache Deletion Successful!");
  } else {
    console.error("❌ Cache Deletion Failed!");
  }

  // Test 2: Queuing Integration
  console.log("\n--- Running Test 2: Queue Integration ---");
  
  // Create a dummy transaction in MongoDB
  console.log("Creating dummy transaction in MongoDB...");
  const dummyTx = await Transaction.create({
    transactionId: "dummy-infra-test-id",
    fromUser: new mongoose.Types.ObjectId(),
    toUser: null,
    amountKES: mongoose.Types.Decimal128.fromString("1.00"),
    transactionCategory: 'subscription_lock',
    paymentMethod: 'wallet',
    paymentSource: 'student_wallet',
    orderType: 'subscription',
    stellarTxHash: null,
    status: 'completed',
    settlementStatus: 'failed', // Start as failed so we can test syncing
    description: 'Infrastructure Test Dummy Transaction'
  });

  const txId = dummyTx._id;
  console.log(`Dummy transaction created with ID: ${txId}`);

  // Mock stellarTreasuryService.settleToEscrow to return a fake hash immediately for tests
  // We save the original function so we can restore it later
  const stellarTreasuryService = require('../services/stellarTreasuryService');
  const originalSettle = stellarTreasuryService.settleToEscrow;
  stellarTreasuryService.settleToEscrow = async (amount) => {
    console.log(`[Mock Stellar Treasury] settleToEscrow called for amount ${amount} KES.`);
    return "stellar_fake_tx_hash_for_infrastructure_test";
  };

  console.log(`Enqueuing 'subscription_lock' job for transaction ${txId}...`);
  const queueResult = await queueService.addStellarJob('subscription_lock', txId, { amountKES: 1 });
  console.log("Queue registration result:", queueResult);

  // Wait for processing to complete
  console.log("Waiting 5s for worker thread to process job...");
  await new Promise(r => setTimeout(r, 5000));

  // Assert transaction is synced
  const updatedTx = await Transaction.findById(txId);
  console.log("Updated transaction state:");
  console.log(`- settlementStatus: ${updatedTx.settlementStatus}`);
  console.log(`- stellarTxHash: ${updatedTx.stellarTxHash}`);

  if (updatedTx.settlementStatus === 'synced' && updatedTx.stellarTxHash) {
    console.log("✅ Queue Job Processing and DB Update Successful!");
  } else {
    console.error("❌ Queue Job Processing Failed!");
  }

  // Restore mock
  stellarTreasuryService.settleToEscrow = originalSettle;

  // Clean up DB
  console.log("\nCleaning up database...");
  await Transaction.findByIdAndDelete(txId);
  console.log("Dummy transaction deleted.");

  console.log("\n==================================================");
  console.log("           Infrastructure Test Complete           ");
  console.log("==================================================");

  mongoose.connection.close();
  process.exit(0);
}

runTests().catch(err => {
  console.error("Infrastructure Test failed with error:", err);
  process.exit(1);
});
