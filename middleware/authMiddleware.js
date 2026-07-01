

// // middleware/authMiddleware.js
// const jwt = require('jsonwebtoken');
// const User = require('../models/User');
// const admin = require('../config/firebaseAdmin');

// const protect = async (req, res, next) => {
//   let token;

//   const hdr = req.headers.authorization || "";
//   if (hdr.startsWith('Bearer')) {
//     token = hdr.split(' ')[1];
//   }

//   if (!token) {
//     return res.status(401).json({ message: 'Not authorized, no token' });
//   }

//   // 1) Try JWT (existing behavior)
//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = await User.findById(decoded.id).select('-password');
//     if (!req.user) return res.status(401).json({ message: 'Not authorized, user not found' });
//     return next();
//   } catch (error) {
//     // fall through to Firebase
//   }

//   // 2) Try Firebase ID token
//   try {
//     const decodedFb = await admin.auth().verifyIdToken(token);
//     const firebaseUid = decodedFb.uid;

//     if (!firebaseUid) {
//       return res.status(401).json({ message: 'Not authorized, token failed' });
//     }

//     let user = await User.findOne({ firebaseUid }).select('-password');

//     // fallback lookup by email if present (optional)
//     if (!user && decodedFb.email) {
//       user = await User.findOne({ email: decodedFb.email }).select('-password');
//       if (user && !user.firebaseUid) {
//         user.firebaseUid = firebaseUid;
//         if (!user.avatar && decodedFb.picture) user.avatar = decodedFb.picture;
//         if (!user.name && decodedFb.name) user.name = decodedFb.name;
//         await user.save();
//       }
//     }

//     // create user if missing
//     if (!user) {
//       user = await User.create({
//         firebaseUid,
//         email: decodedFb.email || `${firebaseUid}@firebase.local`,
//         name: decodedFb.name || "User",
//         avatar: decodedFb.picture || "",
//         role: "student",
//       });
//       user = await User.findById(user._id).select('-password');
//     }

//     req.user = user;
//     return next();
//   } catch (error) {
//     console.error(error);
//     return res.status(401).json({ message: 'Not authorized, token failed' });
//   }
// };

// module.exports = { protect };




// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const admin = require("../config/firebaseAdmin");

const protect = async (req, res, next) => {
  let token = "";

  const authHeader = req.headers.authorization || "";

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      message: "Not authorized, no token",
    });
  }

  // 1. Try app JWT first
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.id || decoded._id || decoded.sub;

    if (!userId) {
      return res.status(401).json({
        message: "Not authorized, invalid token payload",
      });
    }

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(401).json({
        message: "Not authorized, user not found",
      });
    }

    req.user = user;
    return next();
  } catch (jwtError) {
    // Continue and try Firebase token below.
  }

  // 2. Try Firebase ID token
  try {
    const decodedFb = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedFb.uid;

    if (!firebaseUid) {
      return res.status(401).json({
        message: "Not authorized, Firebase token missing uid",
      });
    }

    let user = await User.findOne({ firebaseUid }).select("-password");

    if (!user && decodedFb.email) {
      user = await User.findOne({
        email: String(decodedFb.email).trim().toLowerCase(),
      }).select("-password");

      if (user && !user.firebaseUid) {
        user.firebaseUid = firebaseUid;

        if (!user.avatar && decodedFb.picture) {
          user.avatar = decodedFb.picture;
        }

        if (!user.name && decodedFb.name) {
          user.name = decodedFb.name;
        }

        await user.save();
      }
    }

    if (!user) {
      return res.status(401).json({
        message:
          "Firebase user is authenticated, but no NutriPay account exists. Please sign up first.",
      });
    }

    req.user = user;
    return next();
  } catch (firebaseError) {
    console.error("AUTH_MIDDLEWARE_ERROR:", {
      name: firebaseError.name,
      code: firebaseError.code,
      message: firebaseError.message,
    });

    return res.status(401).json({
      message: "Not authorized, token failed",
    });
  }
};

const checkActiveWallet = async (req, res, next) => {
  try {
    const Wallet = require("../models/Wallet");
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (wallet && wallet.status !== "active" && wallet.status !== "refund_pending") {
      return res.status(403).json({
        message: `Your wallet is currently ${wallet.status}. This operation is disabled.`
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Export both names so old and new route files both work
module.exports = {
  protect,
  requireAuth: protect,
  checkActiveWallet,
};