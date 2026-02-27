// services/sms.js
const sendSms = require("../utils/sendSms");

async function sendText(to, body /*, fromOverride */) {
  const data = await sendSms(to, body);
  return { ok: true, data };
}
const sendSMS = ({ to, body }) => sendText(to, body);

module.exports = { sendText, sendSMS };
