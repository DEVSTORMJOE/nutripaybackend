const mpesaService = require('./mpesaService');
const paymentGatewayService = require('./paymentGatewayService');
const NDashOrder = require('../models/NDashOrder');
const NDashAuditLog = require('../models/NDashAuditLog');
const Transaction = require('../models/Transaction');
const ndashSmsService = require('./ndashSmsService');
const User = require('../models/User');

async function initiateSTKPush(userId, phone, grandTotal) {
  try {
    // Initiate STK push through the unified payment gateway router
    const data = await paymentGatewayService.initiateDeposit(userId, phone, grandTotal, 'quick_order');
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

  // 4b. Send SMS to student confirming order payment & processing
  try {
    const { sendText } = require('./sms');
    const studentPhone = order.student?.phone || phone;
    if (studentPhone) {
      await sendText(studentPhone, `NutriPay: Your N-Dash order #${order.orderId} payment of KES ${order.grandTotal} is confirmed! Your order is now being processed.`);
    }
  } catch (studentSmsErr) {
    console.warn(`[ndashPaymentService] Student SMS notification failed for Order #${order.orderId}:`, studentSmsErr.message);
  }
  
  // 5. Driver Notification & Manual Payout Tracking
  if (order.deliveryAgent) {
    const driver = await User.findById(order.deliveryAgent);
    if (driver && driver.phone) {
      try {
        console.log(`[ndashPaymentService] Order #${order.orderId} paid. Manual driver shopping payout required for KES ${order.shoppingCost} to driver ${driver.phone}`);
        
        // Automated B2C payout paused (requires live B2C production credentials)
        // const b2cRes = await mpesaService.withdrawToMpesa(driver.phone, order.shoppingCost);
        
        // Audit log manual payout pending state for driver
        await NDashAuditLog.create({
          action: 'driver_payout_manual_pending',
          user: driver._id,
          ndashOrder: order._id,
          details: { amount: order.shoppingCost, phone: driver.phone, note: "Automated B2C payout paused. Manual disbursement required." }
        });
        
        // 6. Send SMS to driver with order details
        await ndashSmsService.sendOrderNotification(order, driver);
        
      } catch (payoutErr) {
        console.error(`[ndashPaymentService] Driver notification/audit failed for Order #${order.orderId}:`, payoutErr.message);
        
        // Audit log failed payout/notification
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
