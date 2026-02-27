// backend/controllers/sponsor.controller.js
const Sponsor = require("../models/Sponsors");

function normalize(body = {}) {
  return {
    name: String(body.name || "").trim(),
    logoUrl: String(body.logoUrl || "").trim(),
    href: String(body.href || "").trim(),
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    isActive: body.isActive !== undefined ? !!body.isActive : true,
  };
}

// PUBLIC: GET /api/sponsors?limit=60
exports.listPublic = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 60), 1), 120);

    const items = await Sponsor.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ data: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load sponsors" });
  }
};

// ADMIN: GET /api/sponsors/admin/all
exports.listAdminAll = async (req, res) => {
  try {
    const items = await Sponsor.find({})
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load sponsors" });
  }
};

// ADMIN: POST /api/sponsors/admin
exports.create = async (req, res) => {
  try {
    const payload = normalize(req.body);

    if (!payload.name || !payload.logoUrl) {
      return res.status(400).json({ error: "name and logoUrl are required" });
    }

    const created = await Sponsor.create(payload);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Create failed" });
  }
};

// ADMIN: PUT /api/sponsors/admin/:id
exports.update = async (req, res) => {
  try {
    const payload = normalize(req.body);

    const updated = await Sponsor.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Update failed" });
  }
};

// ADMIN: DELETE /api/sponsors/admin/:id
exports.remove = async (req, res) => {
  try {
    const deleted = await Sponsor.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Delete failed" });
  }
};
