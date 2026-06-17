// server/routes/testimonialsRoutes.js
const router = require("express").Router();
const c = require("../controllers/testimonialsController");

// public
router.get("/", c.listTestimonials);
router.post("/", c.createPublicTestimonial);

// admin (optional)
router.post("/admin", c.createAdminTestimonial);
router.put("/admin/:id", c.updateTestimonial);
router.delete("/admin/:id", c.deleteTestimonial);

module.exports = router;