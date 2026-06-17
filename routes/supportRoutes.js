// server/routes/supportRoutes.js
const router = require("express").Router();
const c = require("../controllers/supportController");

router.post("/contact", c.contactSupport);

module.exports = router;
