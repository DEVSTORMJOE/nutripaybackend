const { sendText } = require('./sms');

async function sendOrderNotification(order, driverUser) {
  if (!driverUser || !driverUser.phone) {
    console.warn(`No phone number for driver ${driverUser?._id || 'unknown'}. SMS not sent.`);
    return;
  }
  
  const frontendUrl = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',')[0] 
    : 'http://localhost:3000';
  const processingLink = `${frontendUrl}/delivery/ndash-process/${order._id}`;
  
  const itemsText = order.items.map(item => `* ${item.name} (Qty: ${item.quantity})`).join('\n');
  const message = `N-Dash Order #${order.orderId}

Student: ${order.student?.name || 'Student'}
Phone: ${order.student?.phone || 'N/A'}
Hostel: ${order.deliveryLocation?.hostelResidence || 'N/A'}
Room: ${order.room || 'N/A'}

Items:
${itemsText}

Shopping Budget: ${order.shoppingCost} KES

Open: ${processingLink}`;

  try {
    const res = await sendText(driverUser.phone, message);
    console.log(`[ndashSmsService] SMS dispatched to driver ${driverUser.phone}:`, res);
    return res;
  } catch (err) {
    console.error(`[ndashSmsService] SMS dispatch failed for driver ${driverUser.phone}:`, err.message);
    throw err;
  }
}

module.exports = { sendOrderNotification };
