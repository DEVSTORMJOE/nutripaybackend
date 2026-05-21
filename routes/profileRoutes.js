// routes/profileRoutes.js
const express = require("express");
const router = express.Router();

const { updateMyPhone } = require("../controllers/profileController");
const { protect } = require("../middleware/authMiddleware");

// ✅ ping to verify mounting
router.get("/ping", (req, res) => res.json({ ok: true, scope: "profile" }));

router.put("/phone", protect, updateMyPhone);

module.exports = router;