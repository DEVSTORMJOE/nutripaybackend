

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
  sendSponsorOTP,
  verifySponsorOTP,
  refresh,
  logout
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiters");

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/firebase", authLimiter, firebaseAuth);
router.post("/change-password", authLimiter, changePassword);
router.post("/sponsor/send-otp", authLimiter, sendSponsorOTP);
router.post("/sponsor/verify-otp", authLimiter, verifySponsorOTP);

router.post("/refresh", refresh);
router.post("/logout", logout);

router.get("/me", protect, me);

// Google signup / incomplete profile completion
router.put("/complete-profile", protect, completeProfile);

module.exports = router;