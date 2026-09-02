const cron = require('node-cron');
const CustomOrder = require('../models/CustomOrder');
const payheroService = require('./payheroService');
const walletService = require('./walletService');

/**
 * Scans MongoDB for any CustomOrder in 'pending_payment' state created in the last 2 hours.
 * Queries PayHero API to verify if payment was completed, and automatically fulfills the order.
 */
async function reconcilePendingOrders() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    // Find all pending orders created in the last 2 hours
    const pendingOrders = await CustomOrder.find({
      status: 'pending_payment',
      createdAt: { $gte: twoHoursAgo }
    }).limit(20);

    if (pendingOrders.length === 0) {
      return { checked: 0, fulfilled: 0 };
    }

    console.log(`[Order Reconciliation] Checking ${pendingOrders.length} pending_payment order(s)...`);

    let fulfilledCount = 0;

    for (const order of pendingOrders) {
      try {
        const reference = order.checkoutRequestID || order.orderId;
        if (!reference) continue;

        const statusRes = await payheroService.checkTransactionStatus(reference);

        if (statusRes && statusRes.found && statusRes.success) {
          console.log(`[Order Reconciliation] Found paid order ${order.orderId} on PayHero (Receipt: ${statusRes.receiptNumber || 'N/A'})! Fulfilling now...`);

          const amountPaid = statusRes.amount || order.totalCost;
          const receiptNumber = statusRes.receiptNumber || `PH_REC_${Date.now()}`;
          const phonePaidFrom = statusRes.phone || order.phone || '';

          // Fulfill custom order: update status to preparing, create Delivery record, send SMS & emit socket events
          await walletService.processMpesaDirectCustomOrder(order, amountPaid, receiptNumber, phonePaidFrom);

          fulfilledCount++;
        } else if (statusRes && statusRes.found && statusRes.failed) {
          console.log(`[Order Reconciliation] Order ${order.orderId} confirmed failed/cancelled on PayHero. Marking status = failed.`);
          order.status = 'failed';
          await order.save();
        }
      } catch (err) {
        console.error(`[Order Reconciliation] Error reconciling order ${order.orderId}:`, err.message);
      }
    }

    if (fulfilledCount > 0) {
      console.log(`[Order Reconciliation] Worker finished. Successfully fulfilled ${fulfilledCount} pending order(s).`);
    }

    return { checked: pendingOrders.length, fulfilled: fulfilledCount };
  } catch (error) {
    console.error("[Order Reconciliation] Worker encountered an error:", error.message);
  }
}

// Automatically schedule the reconciliation worker every 2 minutes in non-test environments
if (process.env.NODE_ENV !== 'test') {
  console.log("[Order Reconciliation Service] Worker registered (Schedule: every 2 minutes)");
  cron.schedule('*/2 * * * *', async () => {
    try {
      await reconcilePendingOrders();
    } catch (e) {
      console.error("[Order Reconciliation Cron Error]:", e.message);
    }
  });
}

module.exports = {
  reconcilePendingOrders
};
