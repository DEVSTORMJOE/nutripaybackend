// backend/routes/sponsor.routes.js
const router = require("express").Router();
const c = require("../controllers/Sponsors");

// If you have admin auth, wrap admin routes:
// const requireFirebaseAuth = require("../middleware/authMiddleware");
// const { requireAdminAuth } = require("../middleware/auth");

router.get("/", c.listPublic);

// admin
router.get("/admin/all", /* requireFirebaseAuth, */ c.listAdminAll);
router.post("/admin", /* requireFirebaseAuth, */ c.create);
router.put("/admin/:id", /* requireFirebaseAuth, */ c.update);
router.delete("/admin/:id", /* requireFirebaseAuth, */ c.remove);

module.exports = router;
