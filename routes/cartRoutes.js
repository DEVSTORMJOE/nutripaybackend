const express = require("express");
const router = express.Router();

const { getCart, replaceCart, clearCart } = require("../controllers/cartController");

router.get("/", getCart);
router.put("/",  replaceCart);
router.delete("/clear",  clearCart);

module.exports = router;