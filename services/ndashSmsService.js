const { sendText } = require('./sms');

async function sendOrderNotification(order, driverUser) {
  if (!driverUser || !driverUser.phone) {
    console.warn(`No phone number for driver ${driverUser?._id || 'unknown'}. SMS not sent.`);
    return;
  }
  
  const frontendUrl = process.env.FRONTEND_URL 
    || (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').find(u => u.includes('nutripay.co.ke')) : null) 
    || 'https://nutripay.co.ke';
  const processingLink = `${frontendUrl}/delivery/ndash-process/${order._id}`;
  
  const Student = require('../models/Student');
  let studentProfile = null;
  try {
    studentProfile = await Student.findOne({ user: order.student?._id || order.student }).populate('deliveryLocation');
  } catch (err) {
    console.error('Error fetching student profile for SMS details:', err.message);
  }

  let locationDetail = '';
  const hostelName = order.deliveryLocation?.hostelResidence || studentProfile?.hostel || '';
  const blockName = order.deliveryLocation?.block || studentProfile?.block || '';
  const landmarkInfo = order.deliveryLocation?.landmark || studentProfile?.landmark || '';
  const roomDetails = order.room || studentProfile?.room || 'N/A';
  
  if (order.customLocation) {
    locationDetail = `Location: ${order.customLocation}\nDetails: ${order.room || 'N/A'}`;
  } else if (hostelName) {
    const blockPart = blockName ? `, Block ${blockName}` : '';
    const landmarkPart = landmarkInfo ? `\nLandmark: ${landmarkInfo}` : '';
    locationDetail = `Hostel: ${hostelName}${blockPart}\nRoom: ${roomDetails}${landmarkPart}`;
  } else {
    locationDetail = `Location: Campus\nRoom/Spot Details: ${order.room || 'N/A'}`;
  }

  const itemsText = order.items.map(item => `* ${item.name} (Qty: ${item.quantity})`).join('\n');
  const message = `N-Dash Order #${order.orderId}

Student: ${order.student?.name || 'Student'}
Phone: ${order.student?.phone || 'N/A'}
${locationDetail}

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
