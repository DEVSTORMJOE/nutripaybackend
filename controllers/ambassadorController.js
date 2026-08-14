const Ambassador = require("../models/Ambassador");
const User = require("../models/User");
const ReferralLog = require("../models/ReferralLog");
const SystemSettings = require("../models/SystemSettings");

// Helper to check module status
async function isModuleEnabled() {
  return await SystemSettings.getSetting("ambassador_module_enabled", true);
}

/**
 * Public: Get active ambassadors dropdown list
 */
async function getPublicAmbassadors(req, res) {
  try {
    const enabled = await isModuleEnabled();
    if (!enabled) {
      return res.json({
        enabled: false,
        message: "Ambassador Referral Program is currently paused.",
        ambassadors: [],
      });
    }

    const ambassadors = await Ambassador.find({ isActive: true })
      .select("name campus totalReferrals")
      .sort({ name: 1 });

    return res.json({
      enabled: true,
      ambassadors,
    });
  } catch (error) {
    console.error("GET_PUBLIC_AMBASSADORS_ERROR:", error);
    return res.status(500).json({ message: "Failed to load ambassadors" });
  }
}

/**
 * Public: Get stats for a selected ambassador (for zero-friction live widget)
 */
async function getAmbassadorStats(req, res) {
  try {
    const { ambassadorId } = req.params;
    const enabled = await isModuleEnabled();

    if (!enabled) {
      return res.status(403).json({ message: "Program disabled" });
    }

    const ambassador = await Ambassador.findById(ambassadorId);
    if (!ambassador) {
      return res.status(404).json({ message: "Ambassador not found" });
    }

    // Fetch recent referrals linked to this ambassador
    const recentLogs = await ReferralLog.find({ ambassadorId })
      .populate("userId", "name email createdAt")
      .sort({ createdAt: -1 })
      .limit(10);

    const formattedRecent = recentLogs.map((log) => ({
      id: log._id,
      clientName: log.userId ? log.userId.name : "Registered Client",
      verifiedAt: log.createdAt,
    }));

    return res.json({
      ambassador: {
        id: ambassador._id,
        name: ambassador.name,
        campus: ambassador.campus,
        totalReferrals: ambassador.totalReferrals,
      },
      recentReferrals: formattedRecent,
    });
  } catch (error) {
    console.error("GET_AMBASSADOR_STATS_ERROR:", error);
    return res.status(500).json({ message: "Failed to load ambassador stats" });
  }
}

/**
 * Public: Verify referral code submitted by ambassador
 */
async function verifyReferral(req, res) {
  try {
    const enabled = await isModuleEnabled();
    if (!enabled) {
      return res.status(403).json({
        message: "Ambassador Referral Program is currently offline or paused.",
      });
    }

    const { ambassadorId, referralCode } = req.body || {};

    if (!ambassadorId || !referralCode) {
      return res.status(400).json({
        message: "Ambassador selection and Verification Code are required.",
      });
    }

    const ambassador = await Ambassador.findById(ambassadorId);
    if (!ambassador || !ambassador.isActive) {
      return res.status(400).json({
        message: "Selected ambassador profile is inactive or invalid.",
      });
    }

    const cleanCode = String(referralCode).trim().toUpperCase();

    // Find registered user by referral code
    const user = await User.findOne({ referralCode: cleanCode });
    if (!user) {
      return res.status(404).json({
        message: "Invalid Verification Code. Please ensure the client provided the exact code from their welcome email.",
      });
    }

    // Check if user has already been verified/linked
    if (user.referredById) {
      return res.status(409).json({
        message: "This client code has already been claimed and linked to an ambassador.",
      });
    }

    // Link user to ambassador
    user.referredById = ambassador._id;
    user.referralVerifiedAt = new Date();
    await user.save();

    // Increment total count
    ambassador.totalReferrals = (ambassador.totalReferrals || 0) + 1;
    await ambassador.save();

    // Audit log
    await ReferralLog.create({
      ambassadorId: ambassador._id,
      userId: user._id,
      verificationCode: cleanCode,
      ipAddress: req.ip || "",
    });

    return res.json({
      success: true,
      message: `Verification successful! Client '${user.name}' linked to Ambassador ${ambassador.name}.`,
      ambassador: {
        id: ambassador._id,
        name: ambassador.name,
        totalReferrals: ambassador.totalReferrals,
      },
    });
  } catch (error) {
    console.error("VERIFY_REFERRAL_ERROR:", error);
    return res.status(500).json({ message: "Referral verification failed" });
  }
}

/* ---------------- ADMIN ENDPOINTS ---------------- */

/**
 * Admin: Get all ambassadors & module configuration state
 */
async function adminGetAmbassadors(req, res) {
  try {
    const enabled = await isModuleEnabled();
    const ambassadors = await Ambassador.find().sort({ createdAt: -1 });
    const totalVerifiedReferrals = await ReferralLog.countDocuments();

    return res.json({
      enabled,
      totalAmbassadors: ambassadors.length,
      totalVerifiedReferrals,
      ambassadors,
    });
  } catch (error) {
    console.error("ADMIN_GET_AMBASSADORS_ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch admin ambassadors" });
  }
}

/**
 * Admin: Add new ambassador
 */
async function adminCreateAmbassador(req, res) {
  try {
    const { name, email, phone, campus, notes } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Ambassador name is required." });
    }

    const ambassador = await Ambassador.create({
      name: name.trim(),
      email: (email || "").trim().toLowerCase(),
      phone: (phone || "").trim(),
      campus: (campus || "Main Campus").trim(),
      notes: (notes || "").trim(),
      isActive: true,
      totalReferrals: 0,
    });

    return res.status(201).json({
      message: "Ambassador created successfully.",
      ambassador,
    });
  } catch (error) {
    console.error("ADMIN_CREATE_AMBASSADOR_ERROR:", error);
    return res.status(500).json({ message: "Failed to create ambassador" });
  }
}

/**
 * Admin: Update / activate / deactivate ambassador
 */
async function adminUpdateAmbassador(req, res) {
  try {
    const { id } = req.params;
    const { name, email, phone, campus, notes, isActive } = req.body || {};

    const ambassador = await Ambassador.findById(id);
    if (!ambassador) {
      return res.status(404).json({ message: "Ambassador not found" });
    }

    if (name !== undefined) ambassador.name = name.trim();
    if (email !== undefined) ambassador.email = email.trim().toLowerCase();
    if (phone !== undefined) ambassador.phone = phone.trim();
    if (campus !== undefined) ambassador.campus = campus.trim();
    if (notes !== undefined) ambassador.notes = notes.trim();
    if (isActive !== undefined) ambassador.isActive = Boolean(isActive);

    await ambassador.save();

    return res.json({
      message: "Ambassador updated successfully.",
      ambassador,
    });
  } catch (error) {
    console.error("ADMIN_UPDATE_AMBASSADOR_ERROR:", error);
    return res.status(500).json({ message: "Failed to update ambassador" });
  }
}

/**
 * Admin: Get detailed referral audit logs
 */
async function adminGetReferralLogs(req, res) {
  try {
    const logs = await ReferralLog.find()
      .populate("ambassadorId", "name campus phone")
      .populate("userId", "name email phone role createdAt")
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ logs });
  } catch (error) {
    console.error("ADMIN_GET_REFERRAL_LOGS_ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch referral logs" });
  }
}

/**
 * Admin: Toggle global ambassador referral module ON/OFF
 */
async function adminToggleModule(req, res) {
  try {
    const { enabled } = req.body || {};
    const newState = Boolean(enabled);

    await SystemSettings.setSetting(
      "ambassador_module_enabled",
      newState,
      "Global master toggle for Ambassador Referral Module"
    );

    return res.json({
      enabled: newState,
      message: `Ambassador Referral Module is now ${newState ? "ENABLED" : "DISABLED"}.`,
    });
  } catch (error) {
    console.error("ADMIN_TOGGLE_MODULE_ERROR:", error);
    return res.status(500).json({ message: "Failed to toggle module status" });
  }
}

module.exports = {
  getPublicAmbassadors,
  getAmbassadorStats,
  verifyReferral,
  adminGetAmbassadors,
  adminCreateAmbassador,
  adminUpdateAmbassador,
  adminGetReferralLogs,
  adminToggleModule,
};
