// server/controllers/supportController.js
const { sendMail } = require("../utils/mailer");

// POST /api/support/contact
exports.contactSupport = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required." });
    }

    const supportEmail = process.env.GMAIL_USER || "nutripayorg@gmail.com";

    // 1. Send Email to Support Team
    await sendMail({
      to: supportEmail,
      subject: `Help Desk Support Ticket: ${subject || "No Subject"}`,
      html: `
        <h3>New Support Ticket Submitted</h3>
        <p><strong>From Name:</strong> ${name}</p>
        <p><strong>From Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject || "N/A"}</p>
        <p><strong>Message:</strong></p>
        <div style="border-left: 3px solid #f81d1d; padding-left: 10px; margin-left: 10px; color: #475569;">
          ${message.replace(/\n/g, "<br />")}
        </div>
      `,
    });

    // 2. Send Confirmation Copy to sender (non-fatal if fails)
    try {
      await sendMail({
        to: email,
        subject: `Ticket Received: ${subject || "Support Request"}`,
        html: `
          <h3>Hello ${name},</h3>
          <p>We have received your support ticket regarding "<strong>${subject || "General Inquiry"}</strong>".</p>
          <p>Our team is currently reviewing it, and we will get back to you within 24 business hours.</p>
          <hr style="border: 0; border-top: 1px solid rgba(2,6,23,0.1);" />
          <p style="font-size: 11px; color: #64748b;">This is an automated confirmation of receipt. Please do not reply to this email directly.</p>
        `,
      });
    } catch (err) {
      console.warn("Failed to send support ticket confirmation copy to sender:", err.message);
    }

    res.json({ ok: true, message: "Support ticket logged and emailed successfully." });
  } catch (error) {
    console.error("Error sending support ticket email:", error);
    res.status(500).json({ error: "Failed to send support ticket email. Please try again." });
  }
};
