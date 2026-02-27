// utils/sendSms.js
require("dotenv").config();
const axios = require("axios");

// Normalize Kenyan numbers to +2547XXXXXXXX
function normalizeKePhone(input) {
  if (!input) return "";
  let p = String(input).replace(/\s+/g, "");
  if (/^07\d{8}$/.test(p)) return "+254" + p.slice(1);
  if (/^01\d{8}$/.test(p)) return "+254" + p.slice(1);
  if (/^7\d{8}$/.test(p))  return "+254" + p;
  if (/^\+\d{10,15}$/.test(p)) return p;
  return p;
}

function mask(str) {
  if (!str) return "(empty)";
  const s = String(str);
  if (s.length <= 4) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(Math.max(0, s.length - 4)) + s.slice(-2);
}

async function sendSms(to, message) {
  // Prefer value that worked in your other app
  const url = (process.env.TEXTSMS_API_URL || "https://sms.textsms.co.ke/api/services/sendsms/").trim();

  // Trim/sanitize env
  const apiKeyRaw    = process.env.TEXTSMS_API_KEY || process.env.SMS_API_KEY || "";
  const partnerRaw   = process.env.PARTNER_ID || process.env.TEXTSMS_PARTNER_ID || "";
  const senderRaw    = process.env.SENDER_ID || process.env.TEXTSMS_SENDER || "";

  const apikey    = apiKeyRaw.trim();
  const partnerID = partnerRaw.trim();
  const shortcode = senderRaw.trim();

  // Debug (masked)
  if (process.env.SMS_DEBUG === "1") {
    console.log("📡 SMS API URL:", url);
    console.log("🔑 apikey:", mask(apikey), " len:", apikey.length);
    console.log("👔 partnerID:", partnerID ? mask(partnerID) : "(omitted)");
    console.log("🆔 shortcode(SENDER_ID):", mask(shortcode), " len:", shortcode.length);
  }

  if (!apikey)  throw new Error("Missing TEXTSMS_API_KEY");
  if (!shortcode) throw new Error("Missing SENDER_ID (shortcode)");
  if (!to)      throw new Error("Missing destination phone");
  if (!message) throw new Error("Missing message body");

  const mobile = normalizeKePhone(to);

  const params = new URLSearchParams({
    apikey,                       // REQUIRED
    shortcode,                    // REQUIRED (sender ID)
    mobile,                       // REQUIRED (recipient)
    message,                      // REQUIRED
  });

  // ⚠️ Only include partnerID if present (wrong value can trigger 1006 on some accounts)
  if (partnerID) params.set("partnerID", partnerID);

  try {
    const res = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true, // let us see the body even on 401
    });

    // Log a concise response in debug
    if (process.env.SMS_DEBUG === "1") {
      const bodyPreview =
        typeof res.data === "string" ? res.data.slice(0, 400) : JSON.stringify(res.data).slice(0, 400);
      console.log(`[SMS] HTTP ${res.status} body:`, bodyPreview);
    }

    if (res.status === 200) return res.data;

    // Standardize provider error
    throw new Error(
      `TextSMS responded ${res.status} ${typeof res.data === "string" ? res.data : JSON.stringify(res.data)}`
    );
  } catch (err) {
    console.error("SMS dispatch failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = sendSms;
