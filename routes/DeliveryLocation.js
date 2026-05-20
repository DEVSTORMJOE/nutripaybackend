// routes/deliveryLocationRoutes.js
const express = require("express");
const router = express.Router();

const {
  listPublicDeliveryLocations,
  listAdminDeliveryLocations,
  createDeliveryLocation,
  updateDeliveryLocation,
  deleteDeliveryLocation,
} = require("../controllers/DeliveryLocation");

// Public for student registration dropdown
router.get("/", listPublicDeliveryLocations);

// Admin management
router.get("/admin/all", listAdminDeliveryLocations);
router.post("/", createDeliveryLocation);
router.put("/:id", updateDeliveryLocation);
router.delete("/:id", deleteDeliveryLocation);

module.exports = router;