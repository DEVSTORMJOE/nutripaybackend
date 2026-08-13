
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

  if (!token && req.query?.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      message: "Not authorized, no token",
    });
  }

  // 1. Try app JWT first
  let tokenHeaderAlg = null;
  try {
    const jwtKeys = require("../config/jwtKeys");
    let secret = process.env.JWT_SECRET;
    try {
      const decodedHeader = jwt.decode(token, { complete: true });
      tokenHeaderAlg = decodedHeader?.header?.alg;
      if (decodedHeader?.header?.kid) {
        secret = jwtKeys.getSecret(decodedHeader.header.kid);
      }
    } catch (decodeErr) {
      // decode failed, fallback to default secret
    }

    const decoded = jwt.verify(token, secret);

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
    // If token is explicitly an HS256 backend token whose verification failed,
    // do not attempt Firebase RS256 verification to avoid algorithm error logs.
    if (tokenHeaderAlg === "HS256") {
      return res.status(401).json({
        message: "Not authorized, token expired or invalid",
      });
    }
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
    const cleanMsg = firebaseError.message && firebaseError.message.includes("<html")
      ? "Error fetching Firebase public keys or network timeout"
      : String(firebaseError.message || "").substring(0, 150);

    console.error("AUTH_MIDDLEWARE_ERROR:", {
      name: firebaseError.name,
      code: firebaseError.code,
      message: cleanMsg,
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