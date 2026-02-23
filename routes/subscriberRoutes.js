// server/routes/subscriberRoutes.js
const express = require("express");
const router = express.Router();
const ctl = require("../controllers/subscriberController");

// Public subscribe (POST /api/subscribe)
router.post("/", ctl.create);

// Public unsubscribe via token link (HTML page)
router.get("/unsubscribe", ctl.unsubscribeByToken);

// Public one-click unsubscribe (returns 204)
router.post("/unsubscribe-oneclick", ctl.unsubscribeOneClick);

// Public: unsubscribe directly by email (used by /unsubscribe React page)
router.post("/unsubscribe/email", ctl.unsubscribeByEmail);

// Public stats & recent masked
router.get("/recent", ctl.getRecentMasked);
router.get("/stats", ctl.getStats);

// Admin list (with search + status filter)
router.get("/admin", ctl.listAdmin);

// Admin: update status (subscribe / unsubscribe)
router.patch("/:id/status", ctl.updateStatus);

// Newsletter send (optional password), logs history
router.post("/newsletter", ctl.sendNewsletter);

// Security (password for sending)
router.get("/newsletter/security", ctl.securityGet);
router.post("/newsletter/security/set", ctl.securitySetFirst);
router.post("/newsletter/security/change", ctl.securityChange);

// History
router.get("/newsletter/history", ctl.historyList);

module.exports = router;