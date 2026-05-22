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

const Vendor = require("../models/Vendor");
const Sponsor = require("../models/Sponsor");
const DeliveryPersonnel = require("../models/DeliveryPersonnel");
const Student = require("../models/Student");

// GET /api/profile
async function getProfile(req, res) {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    let profile = null;

    if (role === 'student') {
      profile = await Student.findOne({ user: userId }).populate('deliveryLocation');
    } else if (role === 'vendor') {
      profile = await Vendor.findOne({ user: userId });
    } else if (role === 'sponsor') {
      profile = await Sponsor.findOne({ user: userId });
    } else if (role === 'delivery') {
      profile = await DeliveryPersonnel.findOne({ user: userId });
    }

    return res.json({ profile, user: req.user });
  } catch (err) {
    return res.status(500).json({ message: "Server Error" });
  }
}

// PUT /api/profile
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const updateData = req.body;

    const userUpdates = {};
    if (updateData.name !== undefined) userUpdates.name = updateData.name;
    if (updateData.phone !== undefined) userUpdates.phone = normalizeKePhone(updateData.phone);
    if (updateData.avatar !== undefined) userUpdates.avatar = updateData.avatar;

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(userId, { $set: userUpdates });
    }

    if (role === "vendor") {
      const vendorUpdates = {};
      if (updateData.name !== undefined) vendorUpdates.businessName = updateData.name;
      if (updateData.phone !== undefined) vendorUpdates.businessPhone = updateData.phone;
      if (updateData.cuisine !== undefined) vendorUpdates.cuisine = updateData.cuisine;
      
      const vendor = await Vendor.findOne({ user: userId });
      if (vendor) {
        Object.assign(vendor, vendorUpdates);
        if (updateData.headquarters !== undefined) {
          if (vendor.locations && vendor.locations.length > 0) {
            vendor.locations[0].name = updateData.headquarters;
            vendor.locations[0].address = updateData.headquarters;
          } else {
            vendor.locations = [{ name: updateData.headquarters, address: updateData.headquarters, status: "Open" }];
          }
        }
        await vendor.save();
      } else {
        const newVendorData = { user: userId, ...vendorUpdates };
        if (updateData.headquarters !== undefined) {
          newVendorData.locations = [{ name: updateData.headquarters, address: updateData.headquarters, status: "Open" }];
        }
        await Vendor.create(newVendorData);
      }
    } else if (role === "sponsor") {
      const sponsorUpdates = {};
      if (updateData.organizationName !== undefined) sponsorUpdates.organizationName = updateData.organizationName;
      if (updateData.phone !== undefined) sponsorUpdates.contactPhone = updateData.phone;
      await Sponsor.findOneAndUpdate(
        { user: userId },
        { $set: sponsorUpdates },
        { new: true, upsert: true }
      );
    } else if (role === "delivery") {
      const deliveryUpdates = {};
      if (updateData.serviceArea !== undefined) deliveryUpdates.serviceArea = updateData.serviceArea;
      if (updateData.transportMode !== undefined) deliveryUpdates.transportMode = updateData.transportMode;
      if (updateData.availability !== undefined) deliveryUpdates.availability = updateData.availability;
      if (updateData.emergencyContact !== undefined) deliveryUpdates.emergencyContact = updateData.emergencyContact;
      await DeliveryPersonnel.findOneAndUpdate(
        { user: userId },
        { $set: deliveryUpdates },
        { new: true, upsert: true }
      );
    } else if (role === "student") {
      const studentUpdates = {};
      const profileData = updateData.profile || updateData;
      if (profileData.university !== undefined) studentUpdates.university = profileData.university;
      if (profileData.campus !== undefined) studentUpdates.campus = profileData.campus;
      if (profileData.hostel !== undefined) studentUpdates.hostel = profileData.hostel;
      if (profileData.block !== undefined) studentUpdates.block = profileData.block;
      if (profileData.room !== undefined) studentUpdates.room = profileData.room;
      if (profileData.landmark !== undefined) studentUpdates.landmark = profileData.landmark;
      if (profileData.deliveryLocation !== undefined) studentUpdates.deliveryLocation = profileData.deliveryLocation || null;
      
      let studentProfile = await Student.findOne({ user: userId });
      if (studentProfile) {
        Object.assign(studentProfile, studentUpdates);
        await studentProfile.save();
      } else {
        await Student.create({ user: userId, ...studentUpdates });
      }
    }

    return res.json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error("updateProfile error:", err);
    return res.status(500).json({ message: err.message || "Failed to update profile" });
  }
}

module.exports = { updateMyPhone, updateProfile, getProfile };