// const express = require("express");
// const router = express.Router();
// const { listMeals } = require("../controllers/mealController");

// router.get("/", listMeals);

// module.exports = router;












// server/routes/mealRoutes.js
const express = require("express");
const router = express.Router();


const { listMeals, createMeal, updateMeal, setMealActive, deleteMeal } = require("../controllers/mealController");

router.get("/", listMeals);

// Admin (protected)
router.post("/",  createMeal);
router.put("/:id",  updateMeal);
router.patch("/:id/active", setMealActive);
router.delete("/:id", deleteMeal);

module.exports = router;