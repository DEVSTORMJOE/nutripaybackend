// const jwt = require('jsonwebtoken');
// const User = require('../models/User');

// const protect = async (req, res, next) => {
//   let token;

//   if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
//     try {
//       token = req.headers.authorization.split(' ')[1];

//       const decoded = jwt.verify(token, process.env.JWT_SECRET);

//       req.user = await User.findById(decoded.id).select('-password');

//       next();
//     } catch (error) {
//       console.error(error);
//       res.status(401).json({ message: 'Not authorized, token failed' });
//     }
//   }

//   if (!token) {
//     res.status(401).json({ message: 'Not authorized, no token' });
//   }
// };

// module.exports = { protect };












// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const admin = require('../config/firebaseAdmin');

const protect = async (req, res, next) => {
  let token;

  const hdr = req.headers.authorization || "";
  if (hdr.startsWith('Bearer')) {
    token = hdr.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  // 1) Try JWT (existing behavior)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'Not authorized, user not found' });
    return next();
  } catch (error) {
    // fall through to Firebase
  }

  // 2) Try Firebase ID token
  try {
    const decodedFb = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedFb.uid;

    if (!firebaseUid) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }

    let user = await User.findOne({ firebaseUid }).select('-password');

    // fallback lookup by email if present (optional)
    if (!user && decodedFb.email) {
      user = await User.findOne({ email: decodedFb.email }).select('-password');
      if (user && !user.firebaseUid) {
        user.firebaseUid = firebaseUid;
        if (!user.avatar && decodedFb.picture) user.avatar = decodedFb.picture;
        if (!user.name && decodedFb.name) user.name = decodedFb.name;
        await user.save();
      }
    }

    // create user if missing
    if (!user) {
      user = await User.create({
        firebaseUid,
        email: decodedFb.email || `${firebaseUid}@firebase.local`,
        name: decodedFb.name || "User",
        avatar: decodedFb.picture || "",
        role: "student",
      });
      user = await User.findById(user._id).select('-password');
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

module.exports = { protect };