// routes/profileRoutes.js
const express = require("express");
const router = express.Router();

const { updateMyPhone, updateProfile, getProfile } = require("../controllers/profileController");
const { protect } = require("../middleware/authMiddleware");

// ✅ ping to verify mounting
router.get("/ping", (req, res) => res.json({ ok: true, scope: "profile" }));

router.get("/", protect, getProfile);
router.put("/phone", protect, updateMyPhone);
router.put("/", protect, updateProfile);

module.exports = router;