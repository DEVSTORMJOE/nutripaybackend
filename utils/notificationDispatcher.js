const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:nutripayorg@gmail.com';

if (!vapidPublicKey || !vapidPrivateKey) {
  console.warn("⚠️ VAPID keys missing in environment variables. Generating temporary VAPID keys...");
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.warn(`👉 Add these to your backend .env to keep them persistent:\nVAPID_PUBLIC_KEY=${vapidPublicKey}\nVAPID_PRIVATE_KEY=${vapidPrivateKey}\n`);
}

webpush.setVapidDetails(
  vapidEmail,
  vapidPublicKey,
  vapidPrivateKey
);

const dispatchNotification = async (notification) => {
  try {
    const userId = notification.user.toString();
    const payload = {
      _id: notification._id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      isRead: notification.isRead,
      createdAt: notification.createdAt
    };

    // 1. Emit Socket.IO event if io is bound
    if (global.io) {
      global.io.to(`user_${userId}`).emit('notification:new', payload);
      console.log(`Socket notification emitted to user_${userId}`);
    }

    // 2. Fetch all user subscriptions for Push Notifications
    const subscriptions = await PushSubscription.find({ user: notification.user });
    const pushPayload = JSON.stringify({
      title: notification.title,
      message: notification.message,
      data: {
        id: notification._id,
        url: `/${notification.type === 'delivery' ? 'delivery' : 'student'}/notifications`
      }
    });

    const pushPromises = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({
          endpoint: sub.subscription.endpoint,
          keys: {
            p256dh: sub.subscription.keys.p256dh,
            auth: sub.subscription.keys.auth
          }
        }, pushPayload);
      } catch (err) {
        // If subscription has expired or is invalid (410 Gone / 404 Not Found), delete it from DB
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`Deleting expired push subscription: ${sub.subscription.endpoint}`);
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          console.error(`Error sending push notification:`, err);
        }
      }
    });

    await Promise.all(pushPromises);
  } catch (error) {
    console.error('Error dispatching notification:', error);
  }
};

module.exports = {
  dispatchNotification,
  vapidPublicKey
};
