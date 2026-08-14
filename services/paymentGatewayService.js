const mpesaService = require('./mpesaService');
const payheroService = require('./payheroService');
require('dotenv').config();

/**
 * Resolve the active payment gateway ('mpesa' or 'payhero')
 */
async function getActiveGateway() {
  try {
    const SystemSettings = require('../models/SystemSettings');
    const gateway = await SystemSettings.getSetting('active_payment_gateway', process.env.ACTIVE_PAYMENT_GATEWAY || 'mpesa');
    if (gateway) {
      return String(gateway).toLowerCase();
    }
  } catch (err) {
    console.warn("[Payment Gateway] Could not fetch SystemSettings active gateway, using env fallback:", err.message);
  }

  return (process.env.ACTIVE_PAYMENT_GATEWAY || 'mpesa').toLowerCase();
}

/**
 * Unified STK Push deposit initiation
 */
async function initiateDeposit(userId, phone, amountKes, orderType = 'monthly_subscription') {
  const activeGateway = await getActiveGateway();
  console.log(`[Payment Gateway] Processing STK Push via active gateway: '${activeGateway.toUpperCase()}' for user: ${userId}, amount: KES ${amountKes}`);

  if (activeGateway === 'payhero') {
    return await payheroService.initiateDeposit(userId, phone, amountKes, orderType);
  } else {
    // Default to Safaricom M-Pesa
    const res = await mpesaService.initiateDeposit(userId, phone, amountKes, orderType);
    return {
      success: true,
      provider: 'mpesa',
      ...res
    };
  }
}

/**
 * Verify webhook callback data dynamically based on provider
 */
function verifyCallback(body, provider = null) {
  if (provider === 'payhero' || body.payhero || body.external_reference) {
    return payheroService.verifyCallback(body);
  }
  // Default to M-Pesa callback parser
  const res = mpesaService.verifyCallback(body);
  return {
    provider: 'mpesa',
    ...res
  };
}

module.exports = {
  getActiveGateway,
  initiateDeposit,
  verifyCallback
};
