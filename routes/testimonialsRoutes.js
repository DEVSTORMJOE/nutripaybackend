// server/routes/testimonialsRoutes.js
const router = require("express").Router();
const c = require("../controllers/testimonialsController");

// public
router.get("/testimonials", c.listTestimonials);
router.post("/testimonials", c.createPublicTestimonial);

// admin (optional)
router.post("/testimonials/admin", c.createAdminTestimonial);
router.put("/testimonials/admin/:id", c.updateTestimonial);
router.delete("/testimonials/admin/:id", c.deleteTestimonial);

module.exports = router;