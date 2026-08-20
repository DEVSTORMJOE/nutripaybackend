const sendSms = require('./sendSms');
const SystemSettings = require('../models/SystemSettings');

/**
 * Format currency nicely
 */
function fmtKes(amt) {
  const n = Number(amt || 0);
  return `KES ${n.toFixed(2)}`;
}

/**
 * Dispatches Order SMS Notifications to both Student and Admin
 * 
 * @param {Object} opts
 * @param {string} opts.orderType - 'Instant / Quick Order', 'Custom Plan Subscription', 'Monthly Subscription'
 * @param {string} opts.orderId - Order ID or reference string
 * @param {string} opts.studentName - Student's name
 * @param {string} opts.studentPhone - Student's phone number
 * @param {string} [opts.itemsSummary] - Brief list/summary of items ordered
 * @param {number|string} [opts.amountKES] - Total cost in KES
 * @param {string} [opts.verificationCode] - Delivery verification code if available
 */
async function notifyOrderPlacement(opts = {}) {
  const {
    orderType = "Meal Order",
    orderId = "",
    studentName = "Student",
    studentPhone = "",
    itemsSummary = "Meal Items",
    amountKES = 0,
    verificationCode = ""
  } = opts;

  const formattedAmount = fmtKes(amountKES);

  // 1. Send SMS to Student
  if (studentPhone) {
    const studentMsg =
      `NutriPay Order Confirmation!\n` +
      `Hi ${studentName || 'Student'}, your ${orderType} ${orderId ? '#' + orderId + ' ' : ''}is received and is under processing.\n` +
      `Amount: ${formattedAmount}\n` +
      `Thank you for ordering with NutriPay! 🍲`;

    try {
      await sendSms(studentPhone, studentMsg);
      console.log(`[OrderSMS] Student confirmation SMS sent to ${studentPhone}`);
    } catch (err) {
      console.warn(`[OrderSMS] Student SMS error (ignored):`, err.message);
    }
  }

  // 2. Send SMS to Admin (if configured in SystemSettings or ENV)
  try {
    let adminPhone = await SystemSettings.getSetting('order_sms_notification_phone', '');
    if (!adminPhone && process.env.ADMIN_SMS_PHONE) {
      adminPhone = process.env.ADMIN_SMS_PHONE;
    }
    adminPhone = String(adminPhone || "").trim();

    if (adminPhone) {
      const adminMsg =
        `NutriPay New Order Alert!\n` +
        `Type: ${orderType}\n` +
        `Ref: #${orderId || 'N/A'}\n` +
        `Student: ${studentName || 'N/A'} (${studentPhone || 'N/A'})\n` +
        `Items: ${itemsSummary}\n` +
        `Amount: ${formattedAmount}` +
        (verificationCode ? `\nCode: ${verificationCode}` : "");

      await sendSms(adminPhone, adminMsg);
      console.log(`[OrderSMS] Admin notification SMS sent to ${adminPhone}`);
    }
  } catch (err) {
    console.warn(`[OrderSMS] Admin SMS error (ignored):`, err.message);
  }
}

module.exports = {
  notifyOrderPlacement
};
