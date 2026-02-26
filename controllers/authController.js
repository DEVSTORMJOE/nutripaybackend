// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
// const User = require('../models/User');
// const Wallet = require('../models/Wallet');
// const stellarService = require('../services/stellarService');

// const generateToken = (id) => {
//   return jwt.sign({ id }, process.env.JWT_SECRET, {
//     expiresIn: '30d',
//   });
// };

// // @desc    Register new user
// // @route   POST /api/auth/register
// // @access  Public
// const registerUser = async (req, res) => {
//   const { name, email, password, role } = req.body;

//   if (!name || !email || !password || !role) {
//     return res.status(400).json({ message: 'Please add all fields' });
//   }

//   // Check if user exists
//   const userExists = await User.findOne({ email });

//   if (userExists) {
//     return res.status(400).json({ message: 'User already exists' });
//   }

//   // Create User
//   const user = await User.create({
//     name,
//     email,
//     password,
//     role
//   });

//   if (user) {
//     // Create Stellar Wallet for all roles
//     try {
//       const keypair = await stellarService.createWallet();

//       await Wallet.create({
//         user: user._id,
//         stellarPublicKey: keypair.publicKey,
//         stellarSecretKey: keypair.secret, // Custodial storage
//         walletType: role
//       });

//       res.status(201).json({
//         _id: user.id,
//         name: user.name,
//         email: user.email,
//         role: user.role,
//         token: generateToken(user._id),
//       });
//     } catch (error) {
//       console.error("Wallet creation failed", error);
//       // Rollback user
//       await User.findByIdAndDelete(user._id);
//       return res.status(500).json({ message: 'Failed to create wallet for user' });
//     }
//   } else {
//     res.status(400).json({ message: 'Invalid user data' });
//   }
// };

// // @desc    Authenticate a user
// // @route   POST /api/auth/login
// // @access  Public
// const loginUser = async (req, res) => {
//   const { email, password } = req.body;

//   // Check for user email
//   const user = await User.findOne({ email });

//   if (user && (await user.matchPassword(password))) {
//     const wallet = await Wallet.findOne({ user: user._id });

//     res.json({
//       _id: user.id,
//       name: user.name,
//       email: user.email,
//       role: user.role,
//       stellarPublicKey: wallet ? wallet.stellarPublicKey : null,
//       token: generateToken(user._id)
//     });
//   } else {
//     res.status(401).json({ message: 'Invalid credentials' });
//   }
// };

// // @desc    Get user data
// // @route   GET /api/auth/me
// // @access  Private
// const getMe = async (req, res) => {
//   const user = await User.findById(req.user.id).populate('linkedAccounts');
//   const wallet = await Wallet.findOne({ user: req.user.id });

//   res.status(200).json({
//     id: user.id,
//     name: user.name,
//     email: user.email,
//     role: user.role,
//     stellarPublicKey: wallet ? wallet.stellarPublicKey : null,
//     balance: wallet ? wallet.balance : 0
//   });
// };

// module.exports = {
//   registerUser,
//   loginUser,
//   getMe,
// };















// controllers/authController.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const admin = require("../config/firebaseAdmin");

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

async function register(req, res) {
  try {
    const { name, password, role } = req.body || {};
    const email = req.body?.email?.trim().toLowerCase();
    if (!name || !email || !password) return res.status(400).json({ message: "Missing fields" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: "Email already in use" });

    const user = await User.create({
      name,
      email,
      password,
      role: role || "student",
    });

    const token = signToken(user._id);
    const safeUser = await User.findById(user._id).select("-password");
    return res.status(201).json({ token, user: safeUser });
  } catch (e) {
    return res.status(500).json({ message: "Signup failed" });
  }
}

async function login(req, res) {
  try {
    const { password } = req.body || {};
    const email = req.body?.email?.trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ message: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    if (!user.isApproved) {
      return res.status(403).json({ message: "Account pending approval or suspended. Please contact administrator." });
    }

    if (user.role === "vendor") {
      const vendorRecord = await Vendor.findOne({ user: user._id });
      if (vendorRecord && (vendorRecord.approvedStatus === "pending" || vendorRecord.approvedStatus === "rejected")) {
        return res.status(403).json({ message: `Vendor account is currently ${vendorRecord.approvedStatus}. Please contact administrator.` });
      }
    }

    const ok = await user.matchPassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user._id);
    const safeUser = await User.findById(user._id).select("-password");
    return res.json({ token, user: safeUser, requiresPasswordChange: user.requiresPasswordChange });
  } catch (e) {
    return res.status(500).json({ message: "Login failed" });
  }
}

async function firebaseAuth(req, res) {
  try {
    const { idToken, role } = req.body || {};
    if (!idToken) return res.status(400).json({ message: "Missing idToken" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decoded.uid;
    if (!firebaseUid) return res.status(401).json({ message: "Unauthorized" });

    let user = await User.findOne({ firebaseUid });

    // if not found, try email match
    if (!user && decoded.email) {
      user = await User.findOne({ email: decoded.email });
      if (user && !user.firebaseUid) {
        user.firebaseUid = firebaseUid;
        if (!user.avatar && decoded.picture) user.avatar = decoded.picture;
        if (!user.name && decoded.name) user.name = decoded.name;
        await user.save();
      }
    }

    if (!user) {
      user = await User.create({
        firebaseUid,
        email: decoded.email || `${firebaseUid}@firebase.local`,
        name: decoded.name || "User",
        avatar: decoded.picture || "",
        role: role || "student",
      });
    }

    if (!user.isApproved) {
      return res.status(403).json({ message: "Account pending approval or suspended. Please contact administrator." });
    }

    if (user.role === "vendor") {
      const vendorRecord = await Vendor.findOne({ user: user._id });
      if (vendorRecord && (vendorRecord.approvedStatus === "pending" || vendorRecord.approvedStatus === "rejected")) {
        return res.status(403).json({ message: `Vendor account is currently ${vendorRecord.approvedStatus}. Please contact administrator.` });
      }
    }

    const token = signToken(user._id);
    const safeUser = await User.findById(user._id).select("-password");
    return res.json({ token, user: safeUser, requiresPasswordChange: user.requiresPasswordChange });
  } catch (e) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

async function changePassword(req, res) {
  try {
    const { userId, oldPassword, newPassword } = req.body;
    if (!userId || !oldPassword || !newPassword) return res.status(400).json({ message: "Missing fields" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const ok = await user.matchPassword(oldPassword);
    if (!ok) return res.status(401).json({ message: "Invalid old password" });

    user.password = newPassword;
    user.requiresPasswordChange = false;
    await user.save();

    return res.json({ message: "Password updated successfully" });
  } catch (e) {
    return res.status(500).json({ message: "Failed to change password" });
  }
}

module.exports = { register, login, firebaseAuth, changePassword };