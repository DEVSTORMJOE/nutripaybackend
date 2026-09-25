const { sendMail } = require('../utils/mailer');

/* ----------------------------- Legacy Nodemailer Setup (Commented Out) ----------------------------- */
/*
const nodemailer = require('nodemailer');

// Configure transporter (Mock for now, or use Ethereal/Gmail if env vars exist)
const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER || 'test',
    pass: process.env.EMAIL_PASS || 'test'
  }
});
*/

const sendEmail = async (to, subject, text) => {
  try {
    const res = await sendMail({
      to,
      subject,
      text,
    });
    console.log("[NotificationService] Email dispatched via Brevo API:", res.id);
  } catch (error) {
    console.error("[NotificationService] Error sending email:", error.message || error);
  }
};

const sendSponsorRequest = async (sponsorEmail, studentName) => {
  await sendEmail(sponsorEmail, "Funding Request", `Student ${studentName} has requested funding.`);
};

const sendPaymentSuccess = async (email, amount, purpose) => {
  await sendEmail(email, "Payment Successful", `You successfully paid ${amount} XLM for ${purpose}.`);
};

module.exports = {
  sendSponsorRequest,
  sendPaymentSuccess,
  sendEmail
};
