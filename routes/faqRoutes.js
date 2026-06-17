// server/routes/faqRoutes.js
const router = require("express").Router();
const c = require("../controllers/faqController");
const { protect } = require("../middleware/authMiddleware");
const { role } = require("../middleware/roleMiddleware");

// Public routes
router.get("/", c.listFAQs);

// Admin routes (protected by auth and admin role)
router.post("/admin", protect, role("admin"), c.createFAQ);
router.put("/admin/:id", protect, role("admin"), c.updateFAQ);
router.delete("/admin/:id", protect, role("admin"), c.deleteFAQ);

module.exports = router;
