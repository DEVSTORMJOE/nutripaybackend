// const Meal = require("../models/Meal");

// async function listMeals(req, res) {
//   try {
//     const active = req.query.active;
//     const q = {};
//     if (active === "true") q.isActive = true;

//     const items = await Meal.find(q).sort({ createdAt: -1 }).lean();
//     return res.json(items);
//   } catch (e) {
//     return res.status(500).json({ message: "Failed to load meals" });
//   }
// }

// module.exports = { listMeals };













// server/controllers/mealController.js
const Meal = require("../models/Meal");

async function listMeals(req, res) {
  try {
    const active = req.query.active;
    const q = { approvalStatus: "approved" };
    if (active === "true") q.isActive = true;

    const items = await Meal.find(q).sort({ createdAt: -1 }).lean();
    return res.json(items);
  } catch (e) {
    return res.status(500).json({ message: "Failed to load meals" });
  }
}

function normalizeCategory(v) {
  const c = String(v || "").toLowerCase();
  if (!["main", "drink", "fruit"].includes(c)) return null;
  return c;
}

function normalizeNutrition(n) {
  const obj = n && typeof n === "object" ? n : {};
  const num = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    calories: num(obj.calories),
    protein_g: num(obj.protein_g),
    carbs_g: num(obj.carbs_g),
    fat_g: num(obj.fat_g),
    fiber_g: num(obj.fiber_g),
    sugar_g: num(obj.sugar_g),
    sodium_mg: num(obj.sodium_mg),
  };
}

async function createMeal(req, res) {
  try {
    const name = String(req.body.name || "").trim();
    const category = normalizeCategory(req.body.category);
    const description = String(req.body.description || "").trim();
    const imageUrl = String(req.body.imageUrl || "").trim();
    const price = Number(req.body.price);
    const currency = String(req.body.currency || "KES").trim() || "KES";
    const nutrition = normalizeNutrition(req.body.nutrition);
    const isActive = req.body.isActive === false ? false : true;

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!category) return res.status(400).json({ message: "Invalid category" });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "Invalid price" });

    const created = await Meal.create({
      name,
      category,
      description,
      imageUrl,
      price,
      currency,
      nutrition,
      isActive,
    });

    return res.status(201).json(created.toObject());
  } catch (e) {
    return res.status(500).json({ message: "Failed to create meal" });
  }
}

async function updateMeal(req, res) {
  try {
    const id = req.params.id;

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name || "").trim();
    if (req.body.category !== undefined) {
      const c = normalizeCategory(req.body.category);
      if (!c) return res.status(400).json({ message: "Invalid category" });
      patch.category = c;
    }
    if (req.body.description !== undefined) patch.description = String(req.body.description || "").trim();
    if (req.body.imageUrl !== undefined) patch.imageUrl = String(req.body.imageUrl || "").trim();

    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "Invalid price" });
      patch.price = price;
    }

    if (req.body.currency !== undefined) patch.currency = String(req.body.currency || "KES").trim() || "KES";

    if (req.body.nutrition !== undefined) patch.nutrition = normalizeNutrition(req.body.nutrition);

    if (req.body.isActive !== undefined) patch.isActive = Boolean(req.body.isActive);

    if (patch.name !== undefined && !patch.name) return res.status(400).json({ message: "Name is required" });

    const updated = await Meal.findByIdAndUpdate(id, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: "Meal not found" });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Failed to update meal" });
  }
}

async function setMealActive(req, res) {
  try {
    const id = req.params.id;
    const isActive = Boolean(req.body.isActive);

    const updated = await Meal.findByIdAndUpdate(id, { isActive }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: "Meal not found" });

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: "Failed to update status" });
  }
}

async function deleteMeal(req, res) {
  try {
    const id = req.params.id;

    // Prefer soft-delete to avoid breaking historical carts:
    const updated = await Meal.findByIdAndUpdate(id, { isActive: false }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: "Meal not found" });

    return res.json({ ok: true, meal: updated });
  } catch (e) {
    return res.status(500).json({ message: "Failed to delete meal" });
  }
}

module.exports = { listMeals, createMeal, updateMeal, setMealActive, deleteMeal };