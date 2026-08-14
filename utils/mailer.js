// // server/utils/mailer.js
// const nodemailer = require("nodemailer");

// function must(name) {
//   const v = process.env[name];
//   if (!v) throw new Error(`${name} missing in .env`);
//   return v;
// }

// const transport = nodemailer.createTransport({
//   host: must("SMTP_HOST"),
//   port: Number(process.env.SMTP_PORT || 587),
//   secure: String(process.env.SMTP_SECURE || "false") === "true",
//   auth: {
//     user: must("SMTP_USER"),
//     pass: must("SMTP_PASS"),
//   },
// });

// async function sendMail({ to, subject, text, html, headers }) {
//   const from =
//     process.env.MAIL_FROM ||
//     process.env.NEWSLETTER_BRAND_EMAIL ||
//     "no-reply@nutripay.com";

//   return transport.sendMail({
//     from,
//     to,
//     subject,
//     text,
//     html,
//     headers,
//   });
// }

// module.exports = { sendMail };













// server/utils/mailer.js
// - Works with ANY SMTP provider via .env (including Gmail app password)
// - Loads .env safely (no double-loading issues)
// - Verifies transporter once (optional, controlled by env)
// - Normalizes common env naming patterns: SMTP_* and/or GMAIL_*
// - Provides strong runtime logs (no password leakage)

require("dotenv").config();
const nodemailer = require("nodemailer");

/* ----------------------------- helpers ----------------------------- */

function env(name, fallback = "") {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : fallback;
}

function boolEnv(name, fallback = false) {
  const v = env(name);
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function numEnv(name, fallback) {
  const v = env(name);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeGmailAppPassword(pw) {
  // Gmail app passwords are often copied with spaces: "abcd efgh ijkl mnop"
  return String(pw || "").trim().replace(/\s+/g, "");
}

/* ----------------------------- config ----------------------------- */
/**
 * Supported env patterns:
 *
 * Generic SMTP (recommended):
 *   SMTP_HOST=smtp.provider.com
 *   SMTP_PORT=587
 *   SMTP_SECURE=false
 *   SMTP_USER=...
 *   SMTP_PASS=...
 *   MAIL_FROM="NutriPay <no-reply@nutripay.com>"
 *
 * Gmail (optional convenience):
 *   GMAIL_USER=your@gmail.com
 *   GMAIL_APP_PASSWORD=16charAppPassword (can include spaces)
 *   SMTP_FROM="NutriPay <your@gmail.com>"
 */

const NODE_ENV = env("NODE_ENV", "development");
const IS_PROD = NODE_ENV === "production";
const DEBUG_MAILER = boolEnv("MAILER_DEBUG", !IS_PROD);
const VERIFY_ON_BOOT = boolEnv("MAILER_VERIFY_ON_BOOT", false);

// Prefer explicit SMTP_*, else fallback to Gmail envs
const SMTP_HOST =
  env("SMTP_HOST") || (env("GMAIL_USER") ? "smtp.gmail.com" : "");
const SMTP_PORT = numEnv("SMTP_PORT", SMTP_HOST === "smtp.gmail.com" ? 465 : 587);

const SMTP_USER = env("SMTP_USER") || env("GMAIL_USER");
const SMTP_PASS = env("SMTP_PASS") || normalizeGmailAppPassword(env("GMAIL_APP_PASSWORD"));

const SMTP_SECURE =
  env("SMTP_SECURE")
    ? boolEnv("SMTP_SECURE", false)
    : SMTP_HOST === "smtp.gmail.com"
    ? true
    : SMTP_PORT === 465;

const MAIL_FROM =
  env("MAIL_FROM") ||
  env("SMTP_FROM") ||
  (SMTP_USER ? `NutriPay <${SMTP_USER}>` : "NutriPay <no-reply@nutripay.com>");

// Optional TLS controls
const TLS_REJECT_UNAUTHORIZED = boolEnv("SMTP_TLS_REJECT_UNAUTHORIZED", IS_PROD);

// Basic validation (no secrets printed)
if (!SMTP_HOST) {
  throw new Error("SMTP_HOST is missing. Set SMTP_HOST or provide GMAIL_USER to auto-use Gmail.");
}
if (!SMTP_USER) {
  throw new Error("SMTP_USER is missing. Set SMTP_USER or GMAIL_USER.");
}
if (!SMTP_PASS) {
  throw new Error("SMTP_PASS is missing. Set SMTP_PASS or GMAIL_APP_PASSWORD.");
}

// Special check for Gmail app password shape (not mandatory but helpful)
if (SMTP_HOST === "smtp.gmail.com") {
  const pwLen = SMTP_PASS.length;
  // Gmail app password is typically 16 chars (no spaces). Some providers differ.
  if (pwLen !== 16 && DEBUG_MAILER) {
    console.warn("[MAILER] Gmail password length is not 16 after normalization:", pwLen);
  }
}

if (DEBUG_MAILER) {
  console.log("[MAILER] Boot", {
    NODE_ENV,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    PASS_LEN: SMTP_PASS.length,
    MAIL_FROM,
    TLS_REJECT_UNAUTHORIZED,
    CWD: process.cwd(),
  });
}

/* ----------------------------- transporter ----------------------------- */

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: {
    minVersion: "TLSv1.2",
    rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
  },
});

// Optional verification on boot
if (VERIFY_ON_BOOT) {
  transport
    .verify()
    .then(() => console.log("[MAILER] Transport verified"))
    .catch((e) => console.error("[MAILER] Transport verify failed:", e.message));
}

/* ----------------------------- API ----------------------------- */

async function sendMail({ to, subject, html, text, headers, attachments } = {}) {
  if (!to) throw new Error("sendMail: 'to' is required");
  if (!subject) throw new Error("sendMail: 'subject' is required");

  try {
    const info = await transport.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      html: html || (text ? `<pre style="white-space:pre-wrap;">${escapeHtml(text)}</pre>` : " "),
      text: text || "",
      headers,
      attachments,
    });

    if (DEBUG_MAILER) {
      console.log("[MAILER] Sent", {
        id: info.messageId || info.response,
        accepted: info.accepted,
        rejected: info.rejected,
      });
    }

    return { ok: true, id: info.messageId || info.response };
  } catch (e) {
    console.error("[MAILER] FAIL", e.message);
    throw e;
  }
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
 * Send a branded welcome email to newly signed up users.
 * If Ambassador Referral Module is enabled, includes the unique referral verification code.
 */
async function sendWelcomeEmail({ to, name, referralCode }) {
  if (!to) return;
  const SystemSettings = require("../models/SystemSettings");
  
  let isAmbassadorEnabled = true;
  try {
    isAmbassadorEnabled = await SystemSettings.getSetting("ambassador_module_enabled", true);
  } catch (err) {
    console.warn("[MAILER] SystemSettings check failed, defaulting enabled:", err.message);
  }

  const safeName = escapeHtml(name || "Student");
  const safeCode = escapeHtml(referralCode || "");

  const referralBlock = isAmbassadorEnabled && safeCode ? `
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
  ` : "";

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

module.exports = { sendMail, sendWelcomeEmail };