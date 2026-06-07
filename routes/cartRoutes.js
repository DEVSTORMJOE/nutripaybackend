const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const { getCart, replaceCart, clearCart, checkoutCart, addSponsorCheckout, customPlanCheckout, customPlanSponsorCheckout, dailyTemplateCheckout } = require("../controllers/cartController");

// Protect all routes requiring req.user
router.get("/", protect, getCart);
router.put("/", protect, replaceCart);
router.delete("/clear", protect, clearCart);
router.post("/checkout", protect, checkoutCart);
router.post("/checkout/sponsor", protect, addSponsorCheckout);
router.post("/checkout/custom-plan", protect, customPlanCheckout);
router.post("/checkout/custom-plan/sponsor", protect, customPlanSponsorCheckout);
router.post("/checkout/daily-template", protect, dailyTemplateCheckout);

module.exports = router;