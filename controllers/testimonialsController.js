// server/controllers/testimonialsController.js
const Testimonial = require("../models/Testimonial");

const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// GET /api/testimonials
// Public: list active by default. Admin can pass all=1 to get everything.
exports.listTestimonials = async (req, res) => {
  try {
    const limit = Math.min(toInt(req.query.limit, 100), 200);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const skip = (page - 1) * limit;

    const where = {};
    if (!req.query.all) where.active = true;
    if (req.query.active === "0") where.active = false;
    if (req.query.active === "1") where.active = true;

    const [items, total] = await Promise.all([
      Testimonial.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Testimonial.countDocuments(where),
    ]);

    res.json({ items, total, page, limit });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list testimonials" });
  }
};

// POST /api/testimonials
// Public: user submission (defaults to active=false)
exports.createPublicTestimonial = async (req, res) => {
  try {
    const { name, location, text, rating, imageUrl } = req.body || {};
    if (!name || !location || !text) {
      return res.status(400).json({ error: "name, location and text are required" });
    }

    const doc = await Testimonial.create({
      name: String(name).trim(),
      location: String(location).trim(),
      text: String(text).trim(),
      imageUrl: imageUrl || "",
      rating: Math.max(1, Math.min(5, Number(rating || 5))),
      active: false, // moderation gate
    });

    res.status(201).json({ ok: true, item: doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create testimonial" });
  }
};

// POST /api/testimonials/admin
exports.createAdminTestimonial = async (req, res) => {
  try {
    const { name, location, text, rating, imageUrl, active } = req.body || {};
    if (!name || !location || !text) {
      return res.status(400).json({ error: "name, location and text are required" });
    }
    const doc = await Testimonial.create({
      name: String(name).trim(),
      location: String(location).trim(),
      text: String(text).trim(),
      imageUrl: imageUrl || "",
      rating: Math.max(1, Math.min(5, Number(rating || 5))),
      active: !!active,
    });
    res.status(201).json({ ok: true, item: doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create testimonial" });
  }
};

// PUT /api/testimonials/admin/:id
exports.updateTestimonial = async (req, res) => {
  try {
    const id = req.params.id;
    const payload = {};
    ["name", "location", "text", "imageUrl"].forEach((k) => {
      if (k in req.body) payload[k] = String(req.body[k] || "").trim();
    });
    if ("rating" in req.body)
      payload.rating = Math.max(1, Math.min(5, Number(req.body.rating)));
    if ("active" in req.body) payload.active = !!req.body.active;

    const updated = await Testimonial.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update testimonial" });
  }
};

// DELETE /api/testimonials/admin/:id
exports.deleteTestimonial = async (req, res) => {
  try {
    const id = req.params.id;
    const out = await Testimonial.findByIdAndDelete(id);
    if (!out) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete testimonial" });
  }
};