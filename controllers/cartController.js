const Cart = require("../models/Cart");

async function getCart(req, res) {
  try {
    const userId = req.user.id;
    let cart = await Cart.findOne({ user: userId }).lean();

    if (!cart) {
      const created = await Cart.create({ user: userId, currency: "KES", templates: [], schedule: {} });
      cart = created.toObject();
    }

    return res.json({
      currency: cart.currency || "KES",
      templates: cart.templates || [],
      schedule: cart.schedule || {},
    });
  } catch (e) {
    return res.status(500).json({ message: "Failed to load cart" });
  }
}

async function replaceCart(req, res) {
  try {
    const userId = req.user.id;

    const currency = req.body.currency || "KES";
    const templates = Array.isArray(req.body.templates) ? req.body.templates : [];
    const schedule = req.body.schedule && typeof req.body.schedule === "object" ? req.body.schedule : {};

    const updated = await Cart.findOneAndUpdate(
      { user: userId },
      { currency, templates, schedule },
      { new: true, upsert: true }
    ).lean();

    return res.json({
      currency: updated.currency,
      templates: updated.templates || [],
      schedule: updated.schedule || {},
    });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save cart" });
  }
}

async function clearCart(req, res) {
  try {
    const userId = req.user.id;
    await Cart.findOneAndUpdate({ user: userId }, { templates: [], schedule: {} }, { upsert: true });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to clear cart" });
  }
}

module.exports = { getCart, replaceCart, clearCart };