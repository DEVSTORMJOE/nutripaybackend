const express = require("express");
const router = express.Router();
const {
  getPublicAmbassadors,
  getAmbassadorStats,
  verifyReferral,
  adminGetAmbassadors,
  adminCreateAmbassador,
  adminUpdateAmbassador,
  adminGetReferralLogs,
  adminToggleModule,
} = require("../controllers/ambassadorController");
const { protect } = require("../middleware/authMiddleware");
const { role } = require("../middleware/roleMiddleware");

/* Public Low-Friction Ambassador Routes */
router.get("/public-list", getPublicAmbassadors);
router.get("/stats/:ambassadorId", getAmbassadorStats);
router.post("/verify-referral", verifyReferral);

/* Admin Protected Ambassador Routes */
router.get("/admin/list", protect, role("admin"), adminGetAmbassadors);
router.post("/admin/create", protect, role("admin"), adminCreateAmbassador);
router.patch("/admin/:id", protect, role("admin"), adminUpdateAmbassador);
router.get("/admin/logs", protect, role("admin"), adminGetReferralLogs);
router.post("/admin/toggle-module", protect, role("admin"), adminToggleModule);

module.exports = router;
