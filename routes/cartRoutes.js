const express = require("express");
const router = express.Router();
const { protect, checkActiveWallet } = require("../middleware/authMiddleware");

const { getCart, replaceCart, clearCart, checkoutCart, addSponsorCheckout, customPlanCheckout, customPlanSponsorCheckout, dailyTemplateCheckout } = require("../controllers/cartController");

// Protect all routes requiring req.user
router.get("/", protect, getCart);
router.put("/", protect, replaceCart);
router.delete("/clear", protect, clearCart);
router.post("/checkout", protect, checkActiveWallet, checkoutCart);
router.post("/checkout/sponsor", protect, checkActiveWallet, addSponsorCheckout);
router.post("/checkout/custom-plan", protect, checkActiveWallet, customPlanCheckout);
router.post("/checkout/custom-plan/sponsor", protect, checkActiveWallet, customPlanSponsorCheckout);
router.post("/checkout/daily-template", protect, checkActiveWallet, dailyTemplateCheckout);

module.exports = router;