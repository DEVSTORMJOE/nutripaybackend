const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const { getCart, replaceCart, clearCart, checkoutCart, addSponsorCheckout } = require("../controllers/cartController");

// Protect all routes requiring req.user
router.get("/", protect, getCart);
router.put("/", protect, replaceCart);
router.delete("/clear", protect, clearCart);
router.post("/checkout", protect, checkoutCart);
router.post("/checkout/sponsor", protect, addSponsorCheckout);

module.exports = router;