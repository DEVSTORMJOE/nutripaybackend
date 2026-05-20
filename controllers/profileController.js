// controllers/profileController.js
const User = require("../models/User");

// Normalize Kenyan numbers to +2547XXXXXXXX (same spirit as your sendSms util)
function normalizeKePhone(input) {
  if (!input) return "";
  let p = String(input).replace(/\s+/g, "");
  if (/^07\d{8}$/.test(p)) return "+254" + p.slice(1);
  if (/^01\d{8}$/.test(p)) return "+254" + p.slice(1);
  if (/^7\d{8}$/.test(p)) return "+254" + p;
  if (/^\+\d{10,15}$/.test(p)) return p;
  return p;
}

function isValidPhone(p) {
  // Keep permissive but safe: E.164 (+XXXXXXXXXX...)
  return /^\+\d{10,15}$/.test(p);
}

// PUT /api/profile/phone
async function updateMyPhone(req, res) {
  try {
    const raw = (req.body?.phone || "").trim();

    // allow clearing phone
    if (!raw) {
      await User.findByIdAndUpdate(req.user.id, { $set: { phone: "" } }, { new: true });
      return res.json({ message: "Phone cleared", phone: "" });
    }

    const phone = normalizeKePhone(raw);

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        message:
          "Invalid phone number. Use Kenyan format (07XXXXXXXX / 7XXXXXXXX) or E.164 (+2547XXXXXXXX).",
      });
    }

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { phone } },
      { new: true, runValidators: false },
    ).select("phone");

    return res.json({
      message: "Phone updated successfully",
      phone: updated?.phone || phone,
    });
  } catch (err) {
    console.error("updateMyPhone error:", err);
    return res.status(500).json({ message: err.message || "Failed to update phone" });
  }
}

module.exports = { updateMyPhone };