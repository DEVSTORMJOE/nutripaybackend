// const express = require("express");
// const router = express.Router();
// const { listMeals } = require("../controllers/mealController");

// router.get("/", listMeals);

// module.exports = router;












// server/routes/mealRoutes.js
const express = require("express");
const router = express.Router();


const { listMeals, createMeal, updateMeal, setMealActive, deleteMeal, getWeeklyPlans, shuffleWeeklyPlan } = require("../controllers/mealController");
const { getSettings } = require("../controllers/adminController");

router.get("/", listMeals);
router.get("/weekly-plans", getWeeklyPlans);
router.post("/weekly-plans/shuffle", shuffleWeeklyPlan);
router.get("/settings", getSettings);

// Admin (protected)
router.post("/",  createMeal);
router.put("/:id",  updateMeal);
router.patch("/:id/active", setMealActive);
router.delete("/:id", deleteMeal);

module.exports = router;