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

module.exports = { sendMail };