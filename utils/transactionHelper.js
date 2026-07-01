const mongoose = require('mongoose');

/**
 * Runs a set of operations in a MongoDB transaction session.
 * Automatically falls back to normal execution in development if a replica set is not initialized.
 * @param {Function} callback - Async function containing operations to run. Receives the session object.
 */
async function runInTransaction(callback) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    const replicaSetError = 
      error.message.includes('replica set') || 
      error.message.includes('ReplicaSetNoPrimary') || 
      error.code === 20 || 
      error.message.includes('transaction');

    if (replicaSetError) {
      console.warn("⚠️  MongoDB replica set not found/configured for transactions. Falling back to non-transactional execution in development.");
      session.endSession();
      // Retry without transaction session context
      return callback(null);
    }
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = {
  runInTransaction
};
