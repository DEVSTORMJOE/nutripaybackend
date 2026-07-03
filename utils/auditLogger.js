const AuditEvent = require('../models/AuditEvent');

/**
 * Helper to log immutable events to the audit database
 * @param {string} actor The operator initiating the action (User ID or 'system')
 * @param {string} action Category of critical operation
 * @param {string} entity Target database entity type
 * @param {string[]} referenceIds Array of target document ObjectIds
 * @param {Object} metadata Arbitrary dictionary of audit context
 * @param {Object} req Optional Express request object to extract IP info
 */
async function logAuditEvent(actor, action, entity, referenceIds = [], metadata = {}, req = null) {
  try {
    const ip = req ? (req.ip || req.connection?.remoteAddress || '127.0.0.1') : '127.0.0.1';
    const event = await AuditEvent.create({
      actor: String(actor),
      action,
      entity,
      referenceIds: referenceIds.map(String),
      metadata,
      ip
    });
    console.log(`[AUDIT EVENT LOGGED] ${action} by ${actor}`);
    return event;
  } catch (err) {
    console.error("Failed to log audit event:", err.message);
  }
}

module.exports = { logAuditEvent };
