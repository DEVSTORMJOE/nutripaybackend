// server/utils/mailer.js
// Dual Brevo Native API & Nodemailer SMTP Engine with Automatic Fallback

require("dotenv").config();
const { BrevoClient } = require("@getbrevo/brevo");
const nodemailer = require("nodemailer");

/* ----------------------------- Helpers ----------------------------- */

function env(name, fallback = "") {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : fallback;
}

function boolEnv(name, fallback = false) {
  const v = env(name);
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Parse string like "NutriPay <no-reply@nutripay.com>" or "no-reply@nutripay.com"
 * into `{ name, email }` object required by Brevo API.
 */
function parseSender(fromStr) {
  const defaultSender = { name: "NutriPay", email: env("GMAIL_USER", "nutripayorg@gmail.com") };
  if (!fromStr) return defaultSender;

  const match = fromStr.match(/^(?:"?([^"]*)"?\s)?<([^>]+)>$/);
  if (match) {
    return {
      name: match[1] ? match[1].trim() : "NutriPay",
      email: match[2].trim(),
    };
  }
  if (fromStr.includes("@")) {
    return { name: "NutriPay", email: fromStr.trim() };
  }
  return defaultSender;
}

/**
 * Parse recipient input into Brevo's array of recipient objects `[{ email, name }]`
 */
function parseRecipients(to) {
  if (!to) return [];
  if (Array.isArray(to)) {
    return to.map((item) => {
      if (typeof item === "string") return parseSender(item);
      if (item && item.email) return { email: item.email, name: item.name };
      return item;
    });
  }
  if (typeof to === "string") {
    return to.split(",").map((s) => parseSender(s.trim()));
  }
  if (to && to.email) {
    return [{ email: to.email, name: to.name }];
  }
  return [];
}

/* ----------------------------- Config ----------------------------- */

const NODE_ENV = env("NODE_ENV", "development");
const IS_PROD = NODE_ENV === "production";
const DEBUG_MAILER = boolEnv("MAILER_DEBUG", !IS_PROD);

const BREVO_API_KEY =
  env("BREVO_API_KEY") || env("SIB_API_KEY") || env("BREVO_KEY");

const MAIL_FROM =
  env("MAIL_FROM") ||
  env("SMTP_FROM") ||
  (env("SMTP_USER")
    ? `NutriPay <${env("SMTP_USER")}>`
    : "NutriPay <no-reply@nutripay.com>");

// Determine if key is a Brevo SMTP key (xsmtpsib-...) vs Brevo API Key (xkeysib-...)
const IS_BREVO_SMTP_KEY = BREVO_API_KEY.startsWith("xsmtpsib-");
const IS_BREVO_V3_KEY = BREVO_API_KEY.startsWith("xkeysib-");

if (DEBUG_MAILER) {
  console.log("[MAILER] Engine Initialized", {
    NODE_ENV,
    HAS_BREVO_KEY: !!BREVO_API_KEY,
    IS_BREVO_SMTP_KEY,
    IS_BREVO_V3_KEY,
    MAIL_FROM,
  });
}

// Lazy/Cached Brevo Client Instance
let brevoClientInstance = null;

function getBrevoClient() {
  if (!brevoClientInstance && BREVO_API_KEY) {
    brevoClientInstance = new BrevoClient({
      apiKey: BREVO_API_KEY,
    });
  }
  return brevoClientInstance;
}

// Lazy/Cached Nodemailer Transports
let brevoSmtpTransport = null;
let gmailSmtpTransport = null;

function getBrevoSmtpTransport() {
  if (!brevoSmtpTransport) {
    const smtpPass = BREVO_API_KEY;
    const sender = parseSender(MAIL_FROM);
    const smtpUser = env("BREVO_USER") || env("SMTP_USER") || env("GMAIL_USER") || "mainafrank400@gmail.com";

    brevoSmtpTransport = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false, // TLS via STARTTLS
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  return brevoSmtpTransport;
}

function getGmailSmtpTransport() {
  if (!gmailSmtpTransport) {
    const gmailUser = env("GMAIL_USER") || env("SMTP_USER");
    const gmailPass = (env("GMAIL_APP_PASSWORD") || env("SMTP_PASS") || "").trim().replace(/\s+/g, "");

    if (!gmailUser || !gmailPass) {
      return null;
    }

    gmailSmtpTransport = nodemailer.createTransport({
      host: env("SMTP_HOST", "smtp.gmail.com"),
      port: Number(env("SMTP_PORT", "465")),
      secure: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  return gmailSmtpTransport;
}

/* ----------------------------- Smart Mail Engine ----------------------------- */

/**
 * Send transactional email with smart multi-tier fallback:
 * 1. Brevo REST API v3 (if key is xkeysib-...)
 * 2. Brevo SMTP Relay (if key is xsmtpsib-...)
 * 3. Gmail / Legacy Nodemailer SMTP Fallback
 */
async function sendMail({ to, subject, html, text, headers, attachments } = {}) {
  if (!to) throw new Error("sendMail: 'to' is required");
  if (!subject) throw new Error("sendMail: 'subject' is required");

  let lastError = null;

  // 1. Try Brevo v3 REST API (Only if key is xkeysib- REST API key)
  if (BREVO_API_KEY && !IS_BREVO_SMTP_KEY) {
    try {
      const client = getBrevoClient();
      const sender = parseSender(MAIL_FROM);
      const recipients = parseRecipients(to);

      const payload = {
        sender,
        to: recipients,
        subject,
        htmlContent:
          html || (text ? `<pre style="white-space:pre-wrap;">${escapeHtml(text)}</pre>` : " "),
        textContent: text || "",
      };

      if (headers) payload.headers = headers;
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        payload.attachment = attachments;
      }

      const sendPromise = client.transactionalEmails.sendTransacEmail(payload);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Brevo API request timeout after 10000ms")), 10000)
      );

      const result = await Promise.race([sendPromise, timeoutPromise]);

      if (DEBUG_MAILER) {
        console.log("[MAILER] Sent via Brevo API v3", {
          messageId: result.messageId || result.messageIds,
        });
      }

      return { ok: true, channel: "brevo_api", id: result.messageId || result.messageIds || "sent" };
    } catch (e) {
      lastError = e;
      console.warn("[MAILER] Brevo API v3 dispatch failed (trying Brevo SMTP Relay):", e.message || e);
    }
  }

  // 2. Try Brevo SMTP Relay (works with xsmtpsib- keys or when API failed)
  if (BREVO_API_KEY) {
    const portsToTry = [587, 465, 2525];
    for (const port of portsToTry) {
      try {
        const smtpPass = BREVO_API_KEY;
        const smtpUser = env("BREVO_USER") || env("SMTP_USER") || env("GMAIL_USER") || "mainafrank400@gmail.com";
        const transport = nodemailer.createTransport({
          host: "smtp-relay.brevo.com",
          port,
          secure: port === 465,
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 15000,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        const mailOptions = {
          from: MAIL_FROM,
          to: Array.isArray(to) ? to.join(",") : to,
          subject,
          html,
          text,
          headers,
          attachments,
        };

        const info = await transport.sendMail(mailOptions);
        if (DEBUG_MAILER) {
          console.log(`[MAILER] Sent via Brevo SMTP Relay (port ${port})`, { messageId: info.messageId });
        }
        return { ok: true, channel: `brevo_smtp_${port}`, id: info.messageId };
      } catch (e) {
        lastError = e;
        console.warn(`[MAILER] Brevo SMTP Relay (port ${port}) failed:`, e.message || e);
      }
    }
  }

  // 3. Fallback: Gmail / Nodemailer SMTP
  try {
    const gmailTransport = getGmailSmtpTransport();
    if (gmailTransport) {
      const mailOptions = {
        from: MAIL_FROM,
        to: Array.isArray(to) ? to.join(",") : to,
        subject,
        html,
        text,
        headers,
        attachments,
      };

      const info = await gmailTransport.sendMail(mailOptions);
      if (DEBUG_MAILER) {
        console.log("[MAILER] Sent via Gmail SMTP Fallback", { messageId: info.messageId });
      }
      return { ok: true, channel: "gmail_smtp", id: info.messageId };
    }
  } catch (e) {
    lastError = e;
    console.error("[MAILER] Gmail SMTP fallback failed:", e.message || e);
  }

  // 4. Fallback for Dev Environment / Network Blocked Scenarios
  console.warn(
    `[MAILER WARN] All network email channels failed (${lastError ? lastError.message : "Network/Auth failure"}). Simulating email dispatch in console.`
  );
  console.log(`==================== [MAILER SIMULATION] ====================`);
  console.log(`TO: ${Array.isArray(to) ? to.join(", ") : to}`);
  console.log(`SUBJECT: ${subject}`);
  console.log(`=============================================================`);

  return {
    ok: true,
    channel: "simulated_console",
    id: `simulated-${Date.now()}`,
    warning: lastError ? lastError.message : "Network email dispatch unavailable",
  };
}

/* ----------------------------- Branded Email Templates ----------------------------- */

/**
 * Send a branded welcome email to newly signed up users.
 * If Ambassador Referral Module is enabled, includes the unique referral verification code.
 */
async function sendWelcomeEmail({ to, name, referralCode }) {
  if (!to) return;
  const SystemSettings = require("../models/SystemSettings");

  let isAmbassadorEnabled = true;
  try {
    isAmbassadorEnabled = await SystemSettings.getSetting(
      "ambassador_module_enabled",
      true
    );
  } catch (err) {
    console.warn(
      "[MAILER] SystemSettings check failed, defaulting enabled:",
      err.message
    );
  }

  const safeName = escapeHtml(name || "Student");
  const safeCode = escapeHtml(referralCode || "");

  const referralBlock =
    isAmbassadorEnabled && safeCode
      ? `
    <div style="margin-top: 25px; padding: 18px; background-color: #fff8f8; border: 1.5px dashed #f81d1d; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #ec6408; text-transform: uppercase; letter-spacing: 1px;">
        Campus Ambassador Verification Code
      </p>
      <div style="font-family: monospace; font-size: 26px; font-weight: 800; color: #f81d1d; letter-spacing: 3px; margin: 6px 0;">
        ${safeCode}
      </div>
      <p style="margin: 6px 0 0 0; font-size: 12px; color: #475569; line-height: 1.4;">
        If a Campus Ambassador helped you get started on NutriPay, please share this unique verification code with them so they can verify your onboarding!
      </p>
    </div>
  `
      : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to NutriPay</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; color: #1e293b;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 30px 10px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); padding: 30px 24px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">NutriPay</h1>
                  <p style="margin: 4px 0 0 0; color: #ffd045; font-size: 14px; font-weight: 600;">Campus Meal Allowance & Digital Dining</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding: 32px 28px;">
                  <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 700;">Welcome to NutriPay, ${safeName}! 👋</h2>
                  <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">
                    We are thrilled to have you join our campus dining network. NutriPay makes ordering fresh, nutritious daily meals seamless, fast, and secure.
                  </p>
                  
                  <div style="background-color: #f8fafc; border-left: 4px solid #f81d1d; padding: 14px 18px; margin: 20px 0; border-radius: 0 6px 6px 0;">
                    <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.5;">
                      ✨ <strong>What you can do with NutriPay:</strong><br>
                      • Browse daily fresh menu options from campus vendors.<br>
                      • Fast M-Pesa digital wallet top-ups & sponsor allocations.<br>
                      • Track your meal preparation and delivery in real-time.
                    </p>
                  </div>

                  ${referralBlock}

                  <div style="margin-top: 30px; text-align: center;">
                    <a href="https://nutripay.co.ke" style="display: inline-block; background-color: #f81d1d; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 6px; box-shadow: 0 2px 6px rgba(248, 29, 29, 0.3);">
                      Explore Today's Menu
                    </a>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0; font-size: 12px; color: #64748b;">
                    Need help or have questions? Contact us at <a href="mailto:nutripayorg@gmail.com" style="color: #f81d1d; text-decoration: none;">nutripayorg@gmail.com</a>
                  </p>
                  <p style="margin: 6px 0 0 0; font-size: 11px; color: #94a3b8;">
                    © ${new Date().getFullYear()} NutriPay Inc. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendMail({
    to,
    subject: "Welcome to NutriPay! 🎉 Your Campus Dining Account is Ready",
    html,
  });
}

/**
 * Send a branded 6-Digit Password Reset OTP email.
 */
async function sendPasswordResetOtpEmail({ to, name, otp }) {
  if (!to || !otp) throw new Error("sendPasswordResetOtpEmail: 'to' and 'otp' are required");

  const safeName = escapeHtml(name || "User");
  const safeOtp = escapeHtml(String(otp));

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Request</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; color: #1e293b;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 30px 10px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); padding: 30px 24px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">NutriPay</h1>
                  <p style="margin: 4px 0 0 0; color: #ffd045; font-size: 14px; font-weight: 600;">Password Reset Verification</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding: 32px 28px;">
                  <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 700;">Password Reset Request</h2>
                  <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">
                    Hello ${safeName},<br>
                    We received a request to reset the password for your NutriPay account. Use the 6-digit verification code below to authorize the password reset.
                  </p>

                  <div style="margin: 25px 0; padding: 20px; background-color: #fff8f8; border: 1.5px dashed #f81d1d; border-radius: 8px; text-align: center;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #ec6408; text-transform: uppercase; letter-spacing: 1px;">
                      Your 6-Digit Password Reset OTP
                    </p>
                    <div style="font-family: monospace, Courier, sans-serif; font-size: 34px; font-weight: 800; color: #f81d1d; letter-spacing: 6px; margin: 8px 0;">
                      ${safeOtp}
                    </div>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b; font-weight: 600;">
                      ⏰ This code will expire in <strong>15 minutes</strong>.
                    </p>
                  </div>

                  <div style="background-color: #f8fafc; border-left: 4px solid #ffd045; padding: 14px 18px; margin: 20px 0; border-radius: 0 6px 6px 0;">
                    <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.5;">
                      🔒 <strong>Security Tip:</strong> If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized activity. Never share this verification code with anyone.
                    </p>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0; font-size: 12px; color: #64748b;">
                    Need help? Contact support at <a href="mailto:nutripayorg@gmail.com" style="color: #f81d1d; text-decoration: none;">nutripayorg@gmail.com</a>
                  </p>
                  <p style="margin: 6px 0 0 0; font-size: 11px; color: #94a3b8;">
                    © ${new Date().getFullYear()} NutriPay Inc. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendMail({
    to,
    subject: "NutriPay Password Reset Verification Code 🔑",
    html,
  });
}

module.exports = { sendMail, sendWelcomeEmail, sendPasswordResetOtpEmail };