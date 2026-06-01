// controllers/deliveryLocationController.js
const DeliveryLocation = require("../models/DeliveryLocation");

function clean(value) {
  return String(value || "").trim();
}

function validateLocation(body) {
  const hostelResidence = clean(body.hostelResidence);

  if (!hostelResidence) return "Hostel / Residence is required.";

  return "";
}

async function listPublicDeliveryLocations(req, res) {
  try {
    const q = clean(req.query.q);

    const filter = {
      isActive: true,
    };

    if (q) {
      filter.$or = [
        { university: { $regex: q, $options: "i" } },
        { campus: { $regex: q, $options: "i" } },
        { hostelResidence: { $regex: q, $options: "i" } },
        { block: { $regex: q, $options: "i" } },
        { room: { $regex: q, $options: "i" } },
        { landmark: { $regex: q, $options: "i" } },
      ];
    }

    const locations = await DeliveryLocation.find(filter)
      .sort({
        hostelResidence: 1,
        block: 1,
        room: 1,
      })
      .lean();

    return res.json({ locations });
  } catch (err) {
    console.error("LIST_PUBLIC_DELIVERY_LOCATIONS_ERROR:", err);
    return res.status(500).json({
      message: "Failed to load delivery locations",
    });
  }
}

async function listAdminDeliveryLocations(req, res) {
  try {
    const locations = await DeliveryLocation.find({})
      .sort({
        createdAt: -1,
      })
      .lean();

    return res.json({ locations });
  } catch (err) {
    console.error("LIST_ADMIN_DELIVERY_LOCATIONS_ERROR:", err);
    return res.status(500).json({
      message: "Failed to load delivery locations",
    });
  }
}

async function createDeliveryLocation(req, res) {
  try {
    const validationMessage = validateLocation(req.body || {});

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const payload = {
      university: clean(req.body.university) || "Egerton University",
      campus: clean(req.body.campus) || "Njoro Main Campus",
      hostelResidence: clean(req.body.hostelResidence),
      block: clean(req.body.block) || "",
      room: clean(req.body.room) || "",
      landmark: clean(req.body.landmark) || "",
      isActive:
        typeof req.body.isActive === "boolean" ? req.body.isActive : true,
    };

    const duplicate = await DeliveryLocation.findOne({
      university: payload.university,
      campus: payload.campus,
      hostelResidence: payload.hostelResidence,
    });

    if (duplicate) {
      return res.status(409).json({
        message: "This delivery location already exists.",
      });
    }

    const location = await DeliveryLocation.create(payload);

    return res.status(201).json({
      message: "Delivery location created successfully.",
      location,
    });
  } catch (err) {
    console.error("CREATE_DELIVERY_LOCATION_ERROR:", err);
    return res.status(500).json({
      message: "Failed to create delivery location",
    });
  }
}

async function updateDeliveryLocation(req, res) {
  try {
    const { id } = req.params;

    const payload = {};

    [
      "university",
      "campus",
      "hostelResidence",
      "block",
      "room",
      "landmark",
    ].forEach((key) => {
      if (req.body[key] !== undefined) {
        payload[key] = clean(req.body[key]);
      }
    });

    if (req.body.isActive !== undefined) {
      payload.isActive = Boolean(req.body.isActive);
    }

    const location = await DeliveryLocation.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    if (!location) {
      return res.status(404).json({
        message: "Delivery location not found.",
      });
    }

    return res.json({
      message: "Delivery location updated successfully.",
      location,
    });
  } catch (err) {
    console.error("UPDATE_DELIVERY_LOCATION_ERROR:", err);
    return res.status(500).json({
      message: "Failed to update delivery location",
    });
  }
}

async function deleteDeliveryLocation(req, res) {
  try {
    const { id } = req.params;

    const location = await DeliveryLocation.findByIdAndDelete(id);

    if (!location) {
      return res.status(404).json({
        message: "Delivery location not found.",
      });
    }

    return res.json({
      message: "Delivery location deleted successfully.",
    });
  } catch (err) {
    console.error("DELETE_DELIVERY_LOCATION_ERROR:", err);
    return res.status(500).json({
      message: "Failed to delete delivery location",
    });
  }
}

module.exports = {
  listPublicDeliveryLocations,
  listAdminDeliveryLocations,
  createDeliveryLocation,
  updateDeliveryLocation,
  deleteDeliveryLocation,
};