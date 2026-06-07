const WaitingList = require('../models/WaitingList');
const { sendMail } = require('../utils/mailer');
const path = require('path');

exports.joinWaitingList = async (req, res) => {
  try {
    const { email, phone, mealPlanPrice } = req.body;

    if (!email || !phone) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const existing = await WaitingList.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    });
    if (existing) {
      if (existing.email === email.toLowerCase() && existing.phone === phone) {
        return res.status(400).json({ message: 'Both this email and phone number are already on the waiting list.' });
      }
      if (existing.email === email.toLowerCase()) {
        return res.status(400).json({ message: 'This email is already on the waiting list.' });
      }
      return res.status(400).json({ message: 'This phone number is already on the waiting list.' });
    }

    const waitlistEntry = await WaitingList.create({
      email,
      phone,
      mealPlanPrice: mealPlanPrice ? Number(mealPlanPrice) : undefined
    });

    // Send styled welcome email (Clean white theme)
    const mailHtml = `
      <div style="font-family: 'Inter', system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="background: linear-gradient(135deg, #f81d1d 0%, #ec6408 100%); padding: 30px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 28px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">Nutri<span style="color: #ffd045;">Pay</span></h1>
          <p style="color: rgba(255,255,255,0.85); font-size: 12px; margin: 5px 0 0 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px;">Smart Dining, Block-Secured</p>
        </div>
        
        <div style="padding: 40px 30px; line-height: 1.6; color: #334155;">
          <h2 style="font-size: 22px; font-weight: 800; margin-top: 0; color: #0f172a; text-align: center;">You're on the list! 🎉</h2>
          <p style="font-size: 15px; color: #475569;">Hi there,</p>
          <p style="font-size: 15px; color: #475569;">
            Thank you for joining the official <strong>NutriPay</strong> waiting list. We are thrilled to have you early on our journey as we build the future of campus dining.
          </p>
          
          <div style="background-color: #fef2f2; border-left: 4px solid #f81d1d; padding: 20px; margin: 30px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 15px; color: #7f1d1d; font-weight: 700;">What happens next?</p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #991b1b; line-height: 1.5;">
              We are working hard to prepare our roll-out. You will be among the very first to get exclusive access and early-bird benefits when we launch. Keep an eye on your inbox!
            </p>
          </div>
          
          <p style="font-size: 15px; color: #475569; margin-top: 30px;">
            Stay hungry for innovation,<br/>
            <strong>The NutriPay Team</strong>
          </p>
        </div>
        
        <div style="background-color: #f8fafc; padding: 25px 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">
          <p style="margin: 0; font-weight: bold;">NutriPay - Decentralized Student Dining Wallet Platform</p>
          <p style="margin: 5px 0 0 0;">This email was sent securely via Stellar Custodial Treasury Notification Service.</p>
          <p style="margin: 15px 0 0 0; color: #94a3b8;">&copy; ${new Date().getFullYear()} NutriPay. All rights reserved.</p>
        </div>
      </div>
    `;

    try {
      await sendMail({
        to: email,
        subject: 'Welcome to the NutriPay Waiting List! 🚀',
        html: mailHtml,
        text: `Hi there, Thank you for joining the NutriPay waiting list! We'll notify you as soon as we launch!`
      });
    } catch (mailError) {
      console.error('Failed to send waitlist confirmation email:', mailError);
      // We still return success as the user was saved
    }

    res.status(201).json({
      message: 'Successfully joined the waiting list.',
      data: waitlistEntry
    });

  } catch (error) {
    console.error('Waitlist join error:', error);
    res.status(500).json({ message: 'Server error while joining waitlist.' });
  }
};

exports.getWaitingList = async (req, res) => {
  try {
    const list = await WaitingList.find().sort({ createdAt: -1 });
    res.status(200).json({ data: list });
  } catch (error) {
    console.error('Fetch waitlist error:', error);
    res.status(500).json({ message: 'Server error fetching waitlist.' });
  }
};

exports.getWaitlistCount = async (req, res) => {
  try {
    const count = await WaitingList.countDocuments();
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};
