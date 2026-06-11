const mpesaService = require('./mpesaService');
const NDashOrder = require('../models/NDashOrder');
const NDashAuditLog = require('../models/NDashAuditLog');
const Transaction = require('../models/Transaction');
const ndashSmsService = require('./ndashSmsService');
const User = require('../models/User');

async function initiateSTKPush(userId, phone, grandTotal) {
  try {
    // Initiate STK push through the existing mpesaService
    const data = await mpesaService.initiateDeposit(userId, phone, grandTotal, 'quick_order');
    return data;
  } catch (err) {
    console.error('[ndashPaymentService] initiateSTKPush error:', err.message);
    throw err;
  }
}

async function processPaymentSuccess(checkoutRequestID, receipt, amount, phone) {
  // 1. Find NDashOrder
  const order = await NDashOrder.findOne({ checkoutRequestID })
    .populate('student')
    .populate('deliveryLocation');
  
  if (!order) {
    console.warn(`[ndashPaymentService] Callback received for CheckoutRequestID ${checkoutRequestID} but no pending N-Dash order found.`);
    return false;
  }
  
  if (order.status !== 'pending_payment') {
    console.log(`[ndashPaymentService] Order ${order.orderId} already processed (status: ${order.status}).`);
    return true;
  }
  
  // 2. Update order status to pending (meaning paid, awaiting driver acceptance/processing)
  order.status = 'pending';
  order.mpesaReceiptNumber = receipt;
  await order.save();
  
  // 3. Create Audit Log for payment success
  await NDashAuditLog.create({
    action: 'payment_success',
    user: order.student?._id,
    ndashOrder: order._id,
    details: { checkoutRequestID, receipt, amount, phone }
  });
  
  // 4. Create Transaction Record for student payment
  await Transaction.create({
    transactionId: receipt || `TX-${order.orderId}`,
    fromUser: order.student?._id,
    toUser: null, // to system
    amountKES: order.grandTotal,
    transactionCategory: 'ndash_payment',
    paymentMethod: 'mpesa',
    status: 'completed',
    description: `N-Dash Payment for Order #${order.orderId}`
  });
  
  // 5. Payout driver shopping cost via M-Pesa B2C
  if (order.deliveryAgent) {
    const driver = await User.findById(order.deliveryAgent);
    if (driver && driver.phone) {
      try {
        console.log(`[ndashPaymentService] Initiating B2C payout of KES ${order.shoppingCost} to driver ${driver.phone}`);
        
        // Dispatch B2C payout
        const b2cRes = await mpesaService.withdrawToMpesa(driver.phone, order.shoppingCost);
        
        // Log transactional audit for driver payout
        await Transaction.create({
          transactionId: b2cRes.conversationId || `B2C-${order.orderId}`,
          fromUser: null, // from system
          toUser: driver._id,
          amountKES: order.shoppingCost,
          transactionCategory: 'ndash_payout',
          paymentMethod: 'mpesa',
          status: 'completed',
          description: `N-Dash Driver Shopping Payout (Order #${order.orderId})`
        });
        
        // Audit log payout
        await NDashAuditLog.create({
          action: 'driver_payout_success',
          user: driver._id,
          ndashOrder: order._id,
          details: { amount: order.shoppingCost, phone: driver.phone, response: b2cRes }
        });
        
        // 6. Send SMS to driver
        await ndashSmsService.sendOrderNotification(order, driver);
        
      } catch (payoutErr) {
        console.error(`[ndashPaymentService] Driver B2C payout failed for Order #${order.orderId}:`, payoutErr.message);
        
        // Audit log failed payout
        await NDashAuditLog.create({
          action: 'driver_payout_failed',
          user: driver._id,
          ndashOrder: order._id,
          details: { amount: order.shoppingCost, phone: driver.phone, error: payoutErr.message }
        });
      }
    }
  }
  
  return true;
}

module.exports = {
  initiateSTKPush,
  processPaymentSuccess
};
