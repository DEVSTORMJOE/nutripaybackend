// server/controllers/subscriberController.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const Subscriber = require("../models/Subscriber");
const NewsletterLog = require("../models/NewsletterLog");
const NewsletterSecurity = require("../models/NewsletterSecurity");
const { sendMail } = require("../utils/mailer");

/* --------------------------------------------------
   Brand configuration (NutriPay)
-------------------------------------------------- */
const BRAND_NAME = process.env.NEWSLETTER_BRAND_NAME || "NutriPay";
const BRAND_EMAIL = process.env.NEWSLETTER_BRAND_EMAIL || "info@nutripay.com";
const BRAND_URL = process.env.NEWSLETTER_BRAND_URL || "";
const FRONTEND_UNSUB_URL = process.env.NEWSLETTER_UNSUB_FRONTEND_URL || "";
const UNSUB_SECRET =
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET ||
  process.env.JWT_SECRET ||
  "PLEASE_CHANGE_THIS_SECRET";

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */
function encodeBase64Url(str = "") {
  return Buffer.from(String(str), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function decodeBase64Url(str = "") {
  let b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Buffer.from(b64, "base64").toString("utf8");
}

function buildBaseUrl(req) {
  const explicit = process.env.PUBLIC_HOST || process.env.NEWSLETTER_UNSUB_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const proto =
    (req.headers["x-forwarded-proto"] || req.protocol || "https")
      .split(",")[0]
      .trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

function createUnsubToken(email) {
  const ts = Math.floor(Date.now() / 1000);
  const norm = String(email).trim().toLowerCase();
  const data = `${norm}|${ts}`;
  const sig = crypto
    .createHmac("sha256", UNSUB_SECRET)
    .update(data)
    .digest("hex")
    .slice(0, 32);
  return encodeBase64Url(`${data}|${sig}`);
}

function parseUnsubToken(token) {
  try {
    const decoded = decodeBase64Url(token);
    const [email, tsStr, sig] = decoded.split("|");
    if (!email || !sig) return null;

    const norm = String(email).trim().toLowerCase();
    const data = `${norm}|${tsStr}`;
    const expected = crypto
      .createHmac("sha256", UNSUB_SECRET)
      .update(data)
      .digest("hex")
      .slice(0, 32);

    if (
      !crypto.timingSafeEqual(
        Buffer.from(sig, "utf8"),
        Buffer.from(expected, "utf8")
      )
    ) {
      return null;
    }

    return { email: norm, ts: parseInt(tsStr, 10) || 0 };
  } catch {
    return null;
  }
}

function buildUnsubLinksFromBase(baseUrl, email) {
  if (!baseUrl) return { unsubPageUrl: "", unsubApiUrl: "" };
  const token = createUnsubToken(email);
  const root = baseUrl.replace(/\/+$/, "");

  return {
    unsubPageUrl: `${root}/api/subscribe/unsubscribe?token=${encodeURIComponent(token)}`,
    unsubApiUrl: `${root}/api/subscribe/unsubscribe-oneclick?token=${encodeURIComponent(token)}`,
  };
}

function renderUnsubPage(title, message) {
  const safeTitle = title || "Newsletter preferences updated";
  const safeMessage =
    message ||
    "Your email preferences have been updated. You will no longer receive our newsletter.";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="max-width:560px;margin:28px auto;background:#fff;border:1px solid #e5e7eb;padding:22px;">
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
        <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7280;">
          Newsletter Preferences
        </div>
        <div style="margin-top:6px;font-size:18px;font-weight:800;color:#111827;">
          ${BRAND_NAME}
        </div>
        <div style="margin-top:14px;font-size:14px;font-weight:700;color:#111827;">${safeTitle}</div>
        <div style="margin-top:6px;font-size:14px;line-height:1.7;color:#4b5563;">${safeMessage}</div>
        ${
          BRAND_URL
            ? `<div style="margin-top:16px;font-size:13px;color:#4b5563;">
                 <a href="${BRAND_URL}" style="color:#1d4ed8;text-decoration:underline;">${BRAND_URL}</a>
               </div>`
            : ""
        }
      </div>
    </div>
  </body>
</html>`;
}

function maskEmail(email = "") {
  const [u, d] = String(email).split("@");
  if (!d) return "***@***";
  const [dn, ...rest] = d.split(".");
  const tld = rest.join(".") || "com";
  const uMask = (u.slice(0, 2) || "*") + "*".repeat(Math.max(1, u.length - 2));
  const dMask = (dn.slice(0, 1) || "*") + "***";
  return `${uMask}@${dMask}.${tld}`;
}

/* --------------------------------------------------
   Public: subscribe
-------------------------------------------------- */
exports.create = async (req, res, next) => {
  try {
    const { name = "", email = "", phone = "" } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email is required" });

    const lower = String(email).trim().toLowerCase();
    let sub = await Subscriber.findOne({ email: lower });

    let isNew = false;
    let reSubscribed = false;

    if (!sub) {
      sub = await Subscriber.create({
        name,
        email: lower,
        phone,
        status: "subscribed",
        source: "website",
      });
      isNew = true;
    } else {
      if (sub.status !== "subscribed") {
        sub.status = "subscribed";
        sub.unsubscribedAt = null;
        reSubscribed = true;
      }
      if (name && !sub.name) sub.name = name;
      if (phone && !sub.phone) sub.phone = phone;
      await sub.save();
    }

    // Send welcome email (optional, fire-and-forget)
    if (isNew || reSubscribed) {
      (async () => {
        try {
          const baseUrl = buildBaseUrl(req);
          const { unsubPageUrl } = buildUnsubLinksFromBase(baseUrl, lower);

          const subject = `Welcome to ${BRAND_NAME} newsletter`;
          const text =
            `Hi,\n\nThanks for joining the ${BRAND_NAME} newsletter.\n` +
            `We’ll email you when we have something useful to share.\n\n` +
            (unsubPageUrl ? `Unsubscribe: ${unsubPageUrl}\n\n` : "") +
            `— ${BRAND_NAME} Team`;

          const html =
            `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#111827;">` +
            `<p style="margin:0 0 10px 0;">Hi,</p>` +
            `<p style="margin:0 0 10px 0;color:#4b5563;">Thanks for joining the <strong>${BRAND_NAME}</strong> newsletter.</p>` +
            (unsubPageUrl
              ? `<p style="margin:12px 0 0 0;font-size:12px;color:#6b7280;">Unsubscribe anytime: <a href="${unsubPageUrl}" style="color:#1d4ed8;text-decoration:underline;">${unsubPageUrl}</a></p>`
              : "") +
            `</div>`;

          await sendMail({ to: lower, subject, text, html });
        } catch (e) {
          console.error("[MAILER] welcome email failed:", e.message);
        }
      })();
    }

    return res.status(201).json({ ok: true, masked: maskEmail(sub.email) });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ message: "This email is already subscribed" });
    }
    next(e);
  }
};

/* --------------------------------------------------
   Public: stats + recent
-------------------------------------------------- */
exports.getRecentMasked = async (req, res, next) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit || "20", 10));
    const docs = await Subscriber.find({ status: "subscribed" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({
      recent: docs.map((d) => ({
        masked: maskEmail(d.email),
        createdAt: d.createdAt,
        name: d.name ? `${d.name.charAt(0)}***` : null,
      })),
    });
  } catch (e) {
    next(e);
  }
};

exports.getStats = async (req, res, next) => {
  try {
    const total = await Subscriber.countDocuments({ status: "subscribed" });
    res.json({ total });
  } catch (e) {
    next(e);
  }
};

/* --------------------------------------------------
   Admin: list + update status
-------------------------------------------------- */
exports.listAdmin = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const size = Math.min(100, Math.max(1, parseInt(req.query.size || "20", 10)));
    const q = (req.query.q || "").trim();
    const statusFilter = (req.query.status || "").trim().toLowerCase();

    const filter = {};
    if (q) {
      filter.$or = [
        { email: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }
    if (statusFilter === "subscribed" || statusFilter === "unsubscribed") {
      filter.status = statusFilter;
    }

    const total = await Subscriber.countDocuments(filter);
    const items = await Subscriber.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean();

    res.json({ items, total, page, size });
  } catch (e) {
    next(e);
  }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const allowed = ["subscribed", "unsubscribed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "status must be subscribed/unsubscribed" });
    }

    const patch = {
      status,
      unsubscribedAt: status === "unsubscribed" ? new Date() : null,
    };

    const doc = await Subscriber.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!doc) return res.status(404).json({ message: "Subscriber not found" });

    res.json({ ok: true, item: doc });
  } catch (e) {
    next(e);
  }
};

/* --------------------------------------------------
   Public: unsubscribe (token / one-click / email)
-------------------------------------------------- */
exports.unsubscribeByToken = async (req, res, next) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).send(renderUnsubPage("Invalid link", "Missing token."));
    }

    const parsed = parseUnsubToken(String(token));
    if (!parsed?.email) {
      return res.status(400).send(renderUnsubPage("Invalid link", "Invalid or expired token."));
    }

    const email = parsed.email.trim().toLowerCase();
    const sub = await Subscriber.findOne({ email });

    if (!sub) {
      return res
        .status(200)
        .send(renderUnsubPage("You’re unsubscribed", "This email is not currently subscribed."));
    }

    if (sub.status !== "unsubscribed") {
      sub.status = "unsubscribed";
      sub.unsubscribedAt = new Date();
      await sub.save();
    }

    return res
      .status(200)
      .send(renderUnsubPage("You’re unsubscribed", "You have been unsubscribed. You can join again anytime."));
  } catch (e) {
    next(e);
  }
};

exports.unsubscribeOneClick = async (req, res, next) => {
  try {
    const token = req.query.token || (req.body && req.body.token);
    if (!token) return res.status(400).json({ ok: false, message: "Missing token" });

    const parsed = parseUnsubToken(String(token));
    if (!parsed?.email) return res.status(400).json({ ok: false, message: "Invalid token" });

    const email = parsed.email.trim().toLowerCase();
    const sub = await Subscriber.findOne({ email });
    if (sub && sub.status !== "unsubscribed") {
      sub.status = "unsubscribed";
      sub.unsubscribedAt = new Date();
      await sub.save();
    }

    return res.status(204).end();
  } catch (e) {
    next(e);
  }
};

exports.unsubscribeByEmail = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, message: "Email is required" });

    const lower = String(email).trim().toLowerCase();
    const sub = await Subscriber.findOne({ email: lower });
    if (!sub) return res.status(404).json({ ok: false, message: "No subscriber found with that email." });

    if (sub.status !== "unsubscribed") {
      sub.status = "unsubscribed";
      sub.unsubscribedAt = new Date();
      await sub.save();
    }

    // Confirmation email (optional)
    try {
      const subject = `You’ve been unsubscribed from ${BRAND_NAME}`;
      const pageUrl = FRONTEND_UNSUB_URL || BRAND_URL || "";
      const text =
        `${lower} has been unsubscribed from ${BRAND_NAME}.\n` +
        (pageUrl ? `Subscribe again: ${pageUrl}\n` : "") +
        `— ${BRAND_NAME} Team`;

      await sendMail({
        to: lower,
        subject,
        text,
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#111827;">
          <p><strong>${lower}</strong> has been unsubscribed from <strong>${BRAND_NAME}</strong>.</p>
          ${pageUrl ? `<p>Subscribe again: <a href="${pageUrl}" style="color:#1d4ed8;text-decoration:underline;">${pageUrl}</a></p>` : ""}
        </div>`,
      });
    } catch (e) {
      console.error("[MAILER] unsubscribe confirmation failed:", e.message);
    }

    return res.json({
      ok: true,
      message: "You have been unsubscribed.",
      status: "unsubscribed",
      email: lower,
      unsubscribedAt: sub.unsubscribedAt,
    });
  } catch (e) {
    next(e);
  }
};

/* --------------------------------------------------
   Security (password for sending)
-------------------------------------------------- */
exports.securityGet = async (req, res, next) => {
  try {
    const doc = await NewsletterSecurity.findOne().lean();
    res.json({ passwordSet: !!doc?.hash });
  } catch (e) {
    next(e);
  }
};

exports.securitySetFirst = async (req, res, next) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ message: "newPassword required" });

    let doc = await NewsletterSecurity.findOne();
    if (doc?.hash) return res.status(409).json({ message: "Password already set. Use change endpoint." });

    const hash = await bcrypt.hash(String(newPassword), 10);
    if (!doc) doc = new NewsletterSecurity({ hash });
    else doc.hash = hash;

    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

exports.securityChange = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "oldPassword and newPassword required" });
    }

    const doc = await NewsletterSecurity.findOne();
    if (!doc?.hash) return res.status(409).json({ message: "No password set yet. Use set endpoint." });

    const ok = await bcrypt.compare(String(oldPassword), doc.hash);
    if (!ok) return res.status(403).json({ message: "Current password invalid" });

    doc.hash = await bcrypt.hash(String(newPassword), 10);
    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

/* --------------------------------------------------
   Admin: send newsletter (with modern unsubscribe + history log)
-------------------------------------------------- */
exports.sendNewsletter = async (req, res, next) => {
  try {
    const {
      subject,
      html = "",
      text = "",
      includeAll = false,
      ids = [],
      password = "",
    } = req.body || {};

    if (!subject || (!html && !text)) {
      return res.status(400).json({ message: "subject and html/text required" });
    }

    // Password required if set
    const sec = await NewsletterSecurity.findOne();
    if (sec?.hash) {
      const ok = await bcrypt.compare(String(password || ""), sec.hash);
      if (!ok) return res.status(403).json({ message: "Send password invalid" });
    }

    let recipients = [];
    if (includeAll) {
      recipients = await Subscriber.find({ status: "subscribed" })
        .select("email name")
        .limit(20000)
        .lean();
    } else if (Array.isArray(ids) && ids.length) {
      recipients = await Subscriber.find({ _id: { $in: ids }, status: "subscribed" })
        .select("email name")
        .lean();
    } else {
      return res.status(400).json({ message: "No recipients selected" });
    }

    const baseUrl = buildBaseUrl(req);
    let sent = 0;
    let failed = 0;

    for (const r of recipients) {
      try {
        let finalHtml = html;
        let finalText = text;
        let headers;

        if (baseUrl) {
          const { unsubPageUrl, unsubApiUrl } = buildUnsubLinksFromBase(baseUrl, r.email);

          // inject {{UNSUB_URL}} or append footer
          if (finalHtml) {
            if (/\{\{\s*UNSUB_URL\s*\}\}/i.test(finalHtml)) {
              finalHtml = finalHtml.replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, unsubPageUrl);
            } else {
              finalHtml += `
<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 12px 0;" />
<p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0;">
  Unsubscribe:
  <a href="${unsubPageUrl}" style="color:#1d4ed8;text-decoration:underline;">${unsubPageUrl}</a>
</p>`;
            }
          }

          if (finalText) {
            if (/\{\{\s*UNSUB_URL\s*\}\}/i.test(finalText)) {
              finalText = finalText.replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, unsubPageUrl);
            } else {
              finalText += `\n\nUnsubscribe: ${unsubPageUrl}`;
            }
          }

          // List-Unsubscribe headers
          const parts = [];
          if (unsubApiUrl) parts.push(`<${unsubApiUrl}>`);
          if (BRAND_EMAIL) parts.push(`<mailto:${BRAND_EMAIL}>`);
          if (parts.length) {
            headers = {
              "List-Unsubscribe": parts.join(", "),
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            };
          }
        }

        await sendMail({
          to: r.email,
          subject,
          html: finalHtml || undefined,
          text: finalText || undefined,
          headers,
        });

        sent++;
      } catch (e) {
        failed++;
        console.error("[MAILER] newsletter send failed:", r.email, e.message);
      }
    }

    const log = await NewsletterLog.create({
      subject,
      html,
      text,
      includeAll,
      ids: includeAll ? [] : ids,
      recipientCount: recipients.length,
      sent,
      failed,
    });

    res.json({ ok: true, sent, failed, logId: log._id });
  } catch (e) {
    next(e);
  }
};

/* --------------------------------------------------
   Admin: history list
-------------------------------------------------- */
exports.historyList = async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit || "50", 10));
    const logs = await NewsletterLog.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("_id subject recipientCount sent failed createdAt")
      .lean();
    res.json({ logs });
  } catch (e) {
    next(e);
  }
};