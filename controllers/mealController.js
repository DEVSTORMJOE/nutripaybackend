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
const WeeklyPlan = require("../models/WeeklyPlan");
const cloudinary = require("../config/cloudinary");
const cacheService = require("../services/cacheService");

/**
 * Extract a Cloudinary public_id from a Cloudinary URL.
 * Returns null if the URL is not a Cloudinary URL.
 * Example URL: https://res.cloudinary.com/<cloud>/image/upload/v1234/nutripay/abc123.webp
 * => public_id: nutripay/abc123
 */
function extractCloudinaryPublicId(url) {
  if (!url || typeof url !== "string") return null;
  // Must be a Cloudinary hosted URL
  if (!url.includes("res.cloudinary.com")) return null;
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split("/");
    // path: /cloud/image/upload/vXXXX/folder/file.ext
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx === -1) return null;
    // skip version segment (starts with 'v' followed by digits)
    let start = uploadIdx + 1;
    if (/^v\d+$/.test(parts[start])) start++;
    const withExtension = parts.slice(start).join("/");
    // Remove file extension
    return withExtension.replace(/\.[^/.]+$/, "");
  } catch {
    return null;
  }
}

async function listMeals(req, res) {
  try {
    const active = req.query.active;
    const categoryFilter = req.query.category;
    const tierFilter = req.query.tier;

    const cacheKey = `meals:list:active-${active || 'all'}:cat-${categoryFilter || 'all'}:tier-${tierFilter || 'all'}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const q = { approvalStatus: "approved" };
    if (active === "true") q.isActive = true;

    if (categoryFilter) {
      const normCat = normalizeCategory(categoryFilter);
      if (normCat) q.category = normCat;
    }

    if (tierFilter && ["normal", "premium"].includes(String(tierFilter).toLowerCase())) {
      q.tier = String(tierFilter).toLowerCase();
    }

    const items = await Meal.find(q)
      .populate({
        path: "vendor",
        populate: { path: "user", select: "name" }
      })
      .sort({ priority: 1, price: 1 })
      .lean();

    await cacheService.set(cacheKey, items, 600); // Cache for 10 minutes
    return res.json(items);
  } catch (e) {
    console.error("Error in listMeals:", e);
    return res.status(500).json({ message: "Failed to load meals", error: e.message });
  }
}

function normalizeCategory(v) {
  const c = String(v || "").toLowerCase().trim().replace(/[\s-]/g, "_");
  if (["main", "drink", "fruit", "fast_food"].includes(c)) return c;
  return null;
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
    const priority = Number.isFinite(Number(req.body.priority)) ? Number(req.body.priority) : 0;
    const tier = ["normal", "premium"].includes(String(req.body.tier || "").toLowerCase())
      ? String(req.body.tier).toLowerCase()
      : "normal";
    const nutrition = normalizeNutrition(req.body.nutrition);
    const isActive = req.body.isActive === false ? false : true;
    const vendorId = req.body.vendorId || req.body.vendor || null;

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!category) return res.status(400).json({ message: "Invalid category" });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "Invalid price" });
    if (!vendorId) return res.status(400).json({ message: "Vendor is required. Please select a vendor." });

    const created = await Meal.create({
      vendor: vendorId,
      name,
      category,
      description,
      imageUrl,
      price,
      currency,
      priority,
      tier,
      nutrition,
      isActive,
      approvalStatus: "approved", // Admin-created meals are auto-approved
    });

    await cacheService.delPattern("meals:*");

    if (global.io) {
      global.io.emit("meal:created", created.toObject());
      global.io.emit("meal:updated", created.toObject());
    }

    return res.status(201).json(created.toObject());
  } catch (e) {
    console.error("Error in createMeal:", e);
    return res.status(500).json({ message: "Failed to create meal", error: e.message });
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

    if (req.body.priority !== undefined) {
      const prio = Number(req.body.priority);
      if (Number.isFinite(prio)) patch.priority = prio;
    }

    if (req.body.tier !== undefined) {
      const t = String(req.body.tier || "").toLowerCase();
      if (["normal", "premium"].includes(t)) patch.tier = t;
    }

    if (req.body.nutrition !== undefined) patch.nutrition = normalizeNutrition(req.body.nutrition);

    if (req.body.isActive !== undefined) patch.isActive = Boolean(req.body.isActive);

    // Allow admin to reassign vendor on edit
    const vendorId = req.body.vendorId || req.body.vendor;
    if (vendorId) patch.vendor = vendorId;

    if (patch.name !== undefined && !patch.name) return res.status(400).json({ message: "Name is required" });

    const updated = await Meal.findByIdAndUpdate(id, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: "Meal not found" });

    await cacheService.delPattern("meals:*");

    if (global.io) {
      global.io.emit("meal:updated", updated);
    }

    return res.json(updated);
  } catch (e) {
    console.error("Error in updateMeal:", e);
    return res.status(500).json({ message: "Failed to update meal", error: e.message });
  }
}

async function setMealActive(req, res) {
  try {
    const id = req.params.id;
    const isActive = Boolean(req.body.isActive);

    const updated = await Meal.findByIdAndUpdate(id, { isActive }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: "Meal not found" });

    await cacheService.delPattern("meals:*");

    if (global.io) {
      global.io.emit("meal:updated", updated);
    }

    return res.json(updated);
  } catch (e) {
    console.error("Error in setMealActive:", e);
    return res.status(500).json({ message: "Failed to update status", error: e.message });
  }
}

async function deleteMeal(req, res) {
  try {
    const id = req.params.id;

    // Fetch first so we can clean up its Cloudinary image
    const meal = await Meal.findById(id).lean();
    if (!meal) return res.status(404).json({ message: "Meal not found" });

    // Attempt Cloudinary deletion — non-fatal if it fails
    const publicId = extractCloudinaryPublicId(meal.imageUrl);
    if (publicId) {
      try {
        const result = await cloudinary.uploader.destroy(publicId);
        console.log(`[Cloudinary] Deleted image '${publicId}':`, result.result);
      } catch (cloudErr) {
        console.warn(`[Cloudinary] Could not delete image '${publicId}':`, cloudErr.message);
      }
    }

    // Hard-delete the DB record
    await Meal.findByIdAndDelete(id);

    await cacheService.delPattern("meals:*");

    if (global.io) {
      global.io.emit("meal:deleted", { id });
      global.io.emit("meal:updated", { id, deleted: true });
    }

    return res.json({ ok: true, message: "Meal deleted successfully" });
  } catch (e) {
    console.error("Error in deleteMeal:", e);
    return res.status(500).json({ message: "Failed to delete meal", error: e.message });
  }
}

async function getWeeklyPlans(req, res) {
  try {
    const filter = {};
    if (req.query.week) filter.week = Number(req.query.week);
    if (req.query.planId) filter.planId = req.query.planId;

    const plans = await WeeklyPlan.find(filter)
      .populate('breakfast')
      .populate('lunch')
      .populate('supper')
      .lean();
    return res.json(plans);
  } catch (e) {
    console.error("Error in getWeeklyPlans:", e);
    return res.status(500).json({ message: "Failed to load weekly plans", error: e.message });
  }
}

async function shuffleWeeklyPlan(req, res) {
  const { planId } = req.body;
  try {
    const Subscription = require('../models/Subscription');
    const subscriberCount = await Subscription.countDocuments({ status: 'active', planId });
    const threshold = Math.max(1, Math.floor(subscriberCount / 3));

    const plans = await WeeklyPlan.find({ planId })
      .populate('breakfast')
      .populate('lunch')
      .populate('supper')
      .lean();

    if (!plans.length) {
      return res.status(404).json({ message: "Weekly plan not found." });
    }

    res.json({
      success: true,
      subscriberCount,
      threshold,
      timetable: plans
    });
  } catch (e) {
    res.status(500).json({ message: "Failed to process shuffle verification: " + e.message });
  }
}

module.exports = { listMeals, createMeal, updateMeal, setMealActive, deleteMeal, getWeeklyPlans, shuffleWeeklyPlan };