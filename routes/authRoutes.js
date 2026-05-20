

// // // routes/authRoutes.js
// // const express = require("express");
// // const router = express.Router();

// // const {
// //   register,
// //   login,
// //   firebaseAuth,
// //   changePassword,
// // } = require("../controllers/authController");

// // router.post("/register", register);
// // router.post("/login", login);
// // router.post("/firebase", firebaseAuth);
// // router.post("/change-password", changePassword);

// // module.exports = router;






// // routes/authRoutes.js
// const express = require("express");
// const router = express.Router();

// const {
//   register,
//   login,
//   firebaseAuth,
//   changePassword,
//   me,
//   completeProfile,
// } = require("../controllers/authController");

// const { protect } = require("../middleware/authMiddleware");

// router.post("/register", register);
// router.post("/login", login);
// router.post("/firebase", firebaseAuth);
// router.post("/change-password", changePassword);

// router.get("/me", protect, me);

// // ✅ Google signup / incomplete profile completion
// router.put("/complete-profile", protect, completeProfile);

// module.exports = router;






// routes/authRoutes.js
const express = require("express");
const router = express.Router();

const {
  register,
  login,
  firebaseAuth,
  changePassword,
  me,
  completeProfile,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

router.post("/register", register);
router.post("/login", login);
router.post("/firebase", firebaseAuth);
router.post("/change-password", changePassword);

router.get("/me", protect, me);

// Google signup / incomplete profile completion
router.put("/complete-profile", protect, completeProfile);

module.exports = router;