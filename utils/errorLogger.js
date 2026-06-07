const ErrorLog = require('../models/ErrorLog');

/**
 * Log a system error/warning to the database for admin auditing
 * @param {string} category - 'wallet', 'auth', 'mpesa', 'database', 'escrow', or 'general'
 * @param {string} message - Description of the error/anomaly
 * @param {object} [metadata] - Optional detailed context (userId, request body, stack trace, etc.)
 * @param {string} [level] - 'info', 'warn', 'error', or 'fatal' (default: 'error')
 */
async function logError(category, message, metadata = {}, level = 'error') {
  try {
    // Sanitize metadata to avoid mongoose serialization failures
    let cleanMetadata = {};
    if (metadata && typeof metadata === 'object') {
      try {
        cleanMetadata = JSON.parse(JSON.stringify(metadata));
      } catch (err) {
        cleanMetadata = { raw: String(metadata) };
      }
    } else if (metadata) {
      cleanMetadata = { info: String(metadata) };
    }

    const logEntry = await ErrorLog.create({
      level,
      category,
      message,
      metadata: cleanMetadata
    });

    console.log(`[AUDIT LOG - ${level.toUpperCase()}] Category: ${category} | Message: ${message}`);
    return logEntry;
  } catch (err) {
    console.error('CRITICAL: Failed to write system error log to database:', err.message);
  }
}

module.exports = {
  logError
};
