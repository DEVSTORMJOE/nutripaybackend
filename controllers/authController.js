
// // // // // controllers/authController.js
// // // // const jwt = require("jsonwebtoken");
// // // // const User = require("../models/User");
// // // // const Vendor = require("../models/Vendor");
// // // // const admin = require("../config/firebaseAdmin");

// // // // function signToken(userId) {
// // // //   return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
// // // // }

// // // // async function register(req, res) {
// // // //   try {
// // // //     const { name, password, role } = req.body || {};
// // // //     const email = req.body?.email?.trim().toLowerCase();
// // // //     if (!name || !email || !password) return res.status(400).json({ message: "Missing fields" });

// // // //     const exists = await User.findOne({ email });
// // // //     if (exists) return res.status(409).json({ message: "Email already in use" });

// // // //     const user = await User.create({
// // // //       name,
// // // //       email,
// // // //       password,
// // // //       role: role || "student",
// // // //     });

// // // //     const token = signToken(user._id);
// // // //     const safeUser = await User.findById(user._id).select("-password");
// // // //     return res.status(201).json({ token, user: safeUser });
// // // //   } catch (e) {
// // // //     return res.status(500).json({ message: "Signup failed" });
// // // //   }
// // // // }

// // // // async function login(req, res) {
// // // //   try {
// // // //     const { password } = req.body || {};
// // // //     const email = req.body?.email?.trim().toLowerCase();
// // // //     if (!email || !password) return res.status(400).json({ message: "Missing fields" });

// // // //     const user = await User.findOne({ email });
// // // //     if (!user) return res.status(401).json({ message: "Invalid credentials" });

// // // //     if (!user.isApproved) {
// // // //       return res.status(403).json({ message: "Account pending approval or suspended. Please contact administrator." });
// // // //     }

// // // //     if (user.role === "vendor") {
// // // //       const vendorRecord = await Vendor.findOne({ user: user._id });
// // // //       if (vendorRecord && (vendorRecord.approvedStatus === "pending" || vendorRecord.approvedStatus === "rejected")) {
// // // //         return res.status(403).json({ message: `Vendor account is currently ${vendorRecord.approvedStatus}. Please contact administrator.` });
// // // //       }
// // // //     }

// // // //     const ok = await user.matchPassword(password);
// // // //     if (!ok) return res.status(401).json({ message: "Invalid credentials" });

// // // //     const token = signToken(user._id);
// // // //     const safeUser = await User.findById(user._id).select("-password");
// // // //     return res.json({ token, user: safeUser, requiresPasswordChange: user.requiresPasswordChange });
// // // //   } catch (e) {
// // // //     return res.status(500).json({ message: "Login failed" });
// // // //   }
// // // // }

// // // // async function firebaseAuth(req, res) {
// // // //   try {
// // // //     const { idToken, role } = req.body || {};
// // // //     if (!idToken) return res.status(400).json({ message: "Missing idToken" });

// // // //     const decoded = await admin.auth().verifyIdToken(idToken);
// // // //     const firebaseUid = decoded.uid;
// // // //     if (!firebaseUid) return res.status(401).json({ message: "Unauthorized" });

// // // //     let user = await User.findOne({ firebaseUid });

// // // //     // if not found, try email match
// // // //     if (!user && decoded.email) {
// // // //       user = await User.findOne({ email: decoded.email });
// // // //       if (user && !user.firebaseUid) {
// // // //         user.firebaseUid = firebaseUid;
// // // //         if (!user.avatar && decoded.picture) user.avatar = decoded.picture;
// // // //         if (!user.name && decoded.name) user.name = decoded.name;
// // // //         await user.save();
// // // //       }
// // // //     }

// // // //     if (!user) {
// // // //       user = await User.create({
// // // //         firebaseUid,
// // // //         email: decoded.email || `${firebaseUid}@firebase.local`,
// // // //         name: decoded.name || "User",
// // // //         avatar: decoded.picture || "",
// // // //         role: role || "student",
// // // //       });
// // // //     }

// // // //     if (!user.isApproved) {
// // // //       return res.status(403).json({ message: "Account pending approval or suspended. Please contact administrator." });
// // // //     }

// // // //     if (user.role === "vendor") {
// // // //       const vendorRecord = await Vendor.findOne({ user: user._id });
// // // //       if (vendorRecord && (vendorRecord.approvedStatus === "pending" || vendorRecord.approvedStatus === "rejected")) {
// // // //         return res.status(403).json({ message: `Vendor account is currently ${vendorRecord.approvedStatus}. Please contact administrator.` });
// // // //       }
// // // //     }

// // // //     const token = signToken(user._id);
// // // //     const safeUser = await User.findById(user._id).select("-password");
// // // //     return res.json({ token, user: safeUser, requiresPasswordChange: user.requiresPasswordChange });
// // // //   } catch (e) {
// // // //     return res.status(401).json({ message: "Unauthorized" });
// // // //   }
// // // // }

// // // // async function changePassword(req, res) {
// // // //   try {
// // // //     const { userId, oldPassword, newPassword } = req.body;
// // // //     if (!userId || !oldPassword || !newPassword) return res.status(400).json({ message: "Missing fields" });

// // // //     const user = await User.findById(userId);
// // // //     if (!user) return res.status(404).json({ message: "User not found" });

// // // //     const ok = await user.matchPassword(oldPassword);
// // // //     if (!ok) return res.status(401).json({ message: "Invalid old password" });

// // // //     user.password = newPassword;
// // // //     user.requiresPasswordChange = false;
// // // //     await user.save();

// // // //     return res.json({ message: "Password updated successfully" });
// // // //   } catch (e) {
// // // //     return res.status(500).json({ message: "Failed to change password" });
// // // //   }
// // // // }

// // // // module.exports = { register, login, firebaseAuth, changePassword };







// // // // controllers/authController.js
// // // const jwt = require("jsonwebtoken");
// // // const User = require("../models/User");
// // // const Student = require("../models/Student");
// // // const Vendor = require("../models/Vendor");
// // // const Sponsor = require("../models/Sponsor");
// // // const DeliveryPersonnel = require("../models/DeliveryPersonnel");
// // // const admin = require("../config/firebaseAdmin");

// // // function signToken(userId) {
// // //   return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
// // // }

// // // function dashboardUrlForRole(role) {
// // //   const r = String(role || "").toLowerCase();

// // //   if (r === "admin") return "/admin/dashboard";
// // //   if (r === "student") return "/student/dashboard";
// // //   if (r === "vendor") return "/vendor/dashboard";
// // //   if (r === "sponsor") return "/sponsor/dashboard";
// // //   if (r === "delivery") return "/delivery/dashboard";

// // //   return "/";
// // // }

// // // function cleanString(value) {
// // //   return String(value || "").trim();
// // // }

// // // function isFilled(value) {
// // //   return cleanString(value).length > 0;
// // // }

// // // async function getRoleProfile(user) {
// // //   if (!user?._id || !user?.role) return null;

// // //   const role = String(user.role).toLowerCase();

// // //   if (role === "student") return Student.findOne({ user: user._id });
// // //   if (role === "vendor") return Vendor.findOne({ user: user._id });
// // //   if (role === "sponsor") return Sponsor.findOne({ user: user._id });
// // //   if (role === "delivery") return DeliveryPersonnel.findOne({ user: user._id });

// // //   return null;
// // // }

// // // function profileIsComplete(role, profile) {
// // //   if (role === "admin") return true;
// // //   if (!profile) return false;

// // //   if (role === "student") {
// // //     return (
// // //       isFilled(profile.university) &&
// // //       isFilled(profile.campus) &&
// // //       isFilled(profile.hostel)
// // //     );
// // //   }

// // //   if (role === "vendor") {
// // //     return (
// // //       isFilled(profile.businessName) &&
// // //       isFilled(profile.businessPhone) &&
// // //       Array.isArray(profile.locations) &&
// // //       profile.locations.length > 0 &&
// // //       isFilled(profile.locations[0]?.name) &&
// // //       isFilled(profile.locations[0]?.address)
// // //     );
// // //   }

// // //   if (role === "sponsor") {
// // //     return (
// // //       isFilled(profile.organizationName) &&
// // //       isFilled(profile.contactPerson) &&
// // //       isFilled(profile.contactPhone)
// // //     );
// // //   }

// // //   if (role === "delivery") {
// // //     return (
// // //       isFilled(profile.serviceArea) &&
// // //       isFilled(profile.transportMode) &&
// // //       isFilled(profile.availability)
// // //     );
// // //   }

// // //   return false;
// // // }

// // // function approvalStatusFor(role, user, profile) {
// // //   if (!user?.isApproved) return "suspended";

// // //   if (role === "vendor") return profile?.approvedStatus || "pending";
// // //   if (role === "sponsor") return profile?.approvedStatus || "pending";
// // //   if (role === "delivery") return profile?.approvedStatus || "pending";

// // //   return "approved";
// // // }

// // // function buildNavigation(user, profile) {
// // //   const role = String(user?.role || "").toLowerCase();
// // //   const profileComplete = profileIsComplete(role, profile);
// // //   const approvalStatus = approvalStatusFor(role, user, profile);

// // //   let nextStep = "dashboard";

// // //   if (user?.requiresPasswordChange) {
// // //     nextStep = "change_password";
// // //   } else if (!user?.isApproved || approvalStatus === "pending" || approvalStatus === "rejected") {
// // //     nextStep = "pending_approval";
// // //   } else if (!profileComplete) {
// // //     nextStep = "complete_profile";
// // //   }

// // //   return {
// // //     profileStatus: {
// // //       profileComplete,
// // //       approvalStatus,
// // //       requiresPasswordChange: Boolean(user?.requiresPasswordChange),
// // //     },
// // //     navigation: {
// // //       nextStep,
// // //       dashboardUrl: dashboardUrlForRole(role),
// // //     },
// // //   };
// // // }

// // // function publicUser(user) {
// // //   if (!user) return null;

// // //   return {
// // //     id: user._id,
// // //     name: user.name,
// // //     email: user.email,
// // //     phone: user.phone || "",
// // //     avatar: user.avatar || "",
// // //     role: user.role,
// // //     isApproved: user.isApproved,
// // //     requiresPasswordChange: user.requiresPasswordChange,
// // //   };
// // // }

// // // async function createRoleProfile({ userId, role, profile = {} }) {
// // //   if (role === "student") {
// // //     return Student.create({
// // //       user: userId,
// // //       stellarPublicKey: cleanString(profile.stellarPublicKey),
// // //       university: cleanString(profile.university),
// // //       campus: cleanString(profile.campus),
// // //       hostel: cleanString(profile.hostel),
// // //       block: cleanString(profile.block),
// // //       room: cleanString(profile.room),
// // //       landmark: cleanString(profile.landmark),
// // //       instructions: cleanString(profile.instructions),
// // //       diet: cleanString(profile.diet),
// // //       allergies: cleanString(profile.allergies),
// // //     });
// // //   }

// // //   if (role === "vendor") {
// // //     return Vendor.create({
// // //       user: userId,
// // //       stellarPublicKey: cleanString(profile.stellarPublicKey),
// // //       businessName: cleanString(profile.businessName),
// // //       businessPhone: cleanString(profile.businessPhone),
// // //       businessEmail: cleanString(profile.businessEmail),
// // //       cuisine: cleanString(profile.cuisine),
// // //       approvedStatus: "pending",
// // //       locations: [
// // //         {
// // //           name: cleanString(profile.locationName),
// // //           address: cleanString(profile.address),
// // //           hours: cleanString(profile.hours),
// // //           status: "Open",
// // //         },
// // //       ],
// // //     });
// // //   }

// // //   if (role === "sponsor") {
// // //     return Sponsor.create({
// // //       user: userId,
// // //       stellarPublicKey: cleanString(profile.stellarPublicKey),
// // //       organizationName: cleanString(profile.organizationName),
// // //       contactPerson: cleanString(profile.contactPerson),
// // //       contactPhone: cleanString(profile.contactPhone),
// // //       sponsorshipType: cleanString(profile.sponsorshipType),
// // //       monthlyBudget: Number(profile.monthlyBudget || 0),
// // //       approvedStatus: "pending",
// // //     });
// // //   }

// // //   if (role === "delivery") {
// // //     return DeliveryPersonnel.create({
// // //       user: userId,
// // //       assignedVendor: profile.assignedVendor || null,
// // //       serviceArea: cleanString(profile.serviceArea),
// // //       transportMode: cleanString(profile.transportMode),
// // //       availability: cleanString(profile.availability),
// // //       emergencyContact: cleanString(profile.emergencyContact),
// // //       approvedStatus: "pending",
// // //     });
// // //   }

// // //   return null;
// // // }

// // // async function register(req, res) {
// // //   try {
// // //     const { name, password, role = "student", phone, profile } = req.body || {};
// // //     const email = req.body?.email?.trim().toLowerCase();

// // //     const cleanRole = String(role || "student").toLowerCase().trim();

// // //     const allowedPublicRoles = ["student", "vendor", "sponsor", "delivery"];

// // //     if (!allowedPublicRoles.includes(cleanRole)) {
// // //       return res.status(400).json({
// // //         message: "Invalid signup role.",
// // //       });
// // //     }

// // //     if (!name || !email || !password) {
// // //       return res.status(400).json({ message: "Missing fields" });
// // //     }

// // //     if (password.length < 6) {
// // //       return res.status(400).json({
// // //         message: "Password must be at least 6 characters.",
// // //       });
// // //     }

// // //     const exists = await User.findOne({ email });

// // //     if (exists) {
// // //       return res.status(409).json({ message: "Email already in use" });
// // //     }

// // //     const user = await User.create({
// // //       name: cleanString(name),
// // //       email,
// // //       phone: cleanString(phone),
// // //       password,
// // //       role: cleanRole,
// // //       isApproved: true,
// // //     });

// // //     const roleProfile = await createRoleProfile({
// // //       userId: user._id,
// // //       role: cleanRole,
// // //       profile: profile || {},
// // //     });

// // //     const token = signToken(user._id);
// // //     const safeUser = await User.findById(user._id).select("-password");
// // //     const nav = buildNavigation(safeUser, roleProfile);

// // //     return res.status(201).json({
// // //       token,
// // //       user: publicUser(safeUser),
// // //       profileStatus: nav.profileStatus,
// // //       navigation: nav.navigation,
// // //     });
// // //   } catch (e) {
// // //     console.error("REGISTER_ERROR:", e);
// // //     return res.status(500).json({ message: "Signup failed" });
// // //   }
// // // }

// // // async function login(req, res) {
// // //   try {
// // //     const { password } = req.body || {};
// // //     const email = req.body?.email?.trim().toLowerCase();

// // //     if (!email || !password) {
// // //       return res.status(400).json({ message: "Missing fields" });
// // //     }

// // //     const user = await User.findOne({ email }).select("+password");

// // //     if (!user) {
// // //       return res.status(401).json({ message: "Invalid credentials" });
// // //     }

// // //     const ok = await user.matchPassword(password);

// // //     if (!ok) {
// // //       return res.status(401).json({ message: "Invalid credentials" });
// // //     }

// // //     const roleProfile = await getRoleProfile(user);
// // //     const safeUser = await User.findById(user._id).select("-password");
// // //     const nav = buildNavigation(safeUser, roleProfile);

// // //     const token = signToken(user._id);

// // //     return res.json({
// // //       token,
// // //       user: publicUser(safeUser),
// // //       profileStatus: nav.profileStatus,
// // //       navigation: nav.navigation,
// // //       requiresPasswordChange: safeUser.requiresPasswordChange,
// // //     });
// // //   } catch (e) {
// // //     console.error("LOGIN_ERROR:", e);
// // //     return res.status(500).json({ message: "Login failed" });
// // //   }
// // // }

// // // async function firebaseAuth(req, res) {
// // //   try {
// // //     const { idToken, role } = req.body || {};

// // //     if (!idToken) {
// // //       return res.status(400).json({ message: "Missing idToken" });
// // //     }

// // //     const decoded = await admin.auth().verifyIdToken(idToken);
// // //     const firebaseUid = decoded.uid;

// // //     if (!firebaseUid) {
// // //       return res.status(401).json({ message: "Unauthorized" });
// // //     }

// // //     let user = await User.findOne({ firebaseUid });

// // //     if (!user && decoded.email) {
// // //       user = await User.findOne({ email: decoded.email });

// // //       if (user && !user.firebaseUid) {
// // //         user.firebaseUid = firebaseUid;
// // //         if (!user.avatar && decoded.picture) user.avatar = decoded.picture;
// // //         if (!user.name && decoded.name) user.name = decoded.name;
// // //         await user.save();
// // //       }
// // //     }

// // //     if (!user) {
// // //       const cleanRole = String(role || "student").toLowerCase().trim();

// // //       user = await User.create({
// // //         firebaseUid,
// // //         email: decoded.email || `${firebaseUid}@firebase.local`,
// // //         name: decoded.name || "User",
// // //         avatar: decoded.picture || "",
// // //         role: ["student", "vendor", "sponsor", "delivery"].includes(cleanRole)
// // //           ? cleanRole
// // //           : "student",
// // //         isApproved: true,
// // //       });

// // //       await createRoleProfile({
// // //         userId: user._id,
// // //         role: user.role,
// // //         profile: {},
// // //       });
// // //     }

// // //     const roleProfile = await getRoleProfile(user);
// // //     const safeUser = await User.findById(user._id).select("-password");
// // //     const nav = buildNavigation(safeUser, roleProfile);

// // //     const token = signToken(user._id);

// // //     return res.json({
// // //       token,
// // //       user: publicUser(safeUser),
// // //       profileStatus: nav.profileStatus,
// // //       navigation: nav.navigation,
// // //       requiresPasswordChange: safeUser.requiresPasswordChange,
// // //     });
// // //   } catch (e) {
// // //     console.error("FIREBASE_AUTH_ERROR:", e);
// // //     return res.status(401).json({ message: "Unauthorized" });
// // //   }
// // // }

// // // async function changePassword(req, res) {
// // //   try {
// // //     const { userId, oldPassword, newPassword } = req.body;

// // //     if (!userId || !oldPassword || !newPassword) {
// // //       return res.status(400).json({ message: "Missing fields" });
// // //     }

// // //     if (newPassword.length < 6) {
// // //       return res.status(400).json({
// // //         message: "New password must be at least 6 characters.",
// // //       });
// // //     }

// // //     const user = await User.findById(userId).select("+password");

// // //     if (!user) {
// // //       return res.status(404).json({ message: "User not found" });
// // //     }

// // //     const ok = await user.matchPassword(oldPassword);

// // //     if (!ok) {
// // //       return res.status(401).json({ message: "Invalid old password" });
// // //     }

// // //     user.password = newPassword;
// // //     user.requiresPasswordChange = false;

// // //     await user.save();

// // //     return res.json({ message: "Password updated successfully" });
// // //   } catch (e) {
// // //     console.error("CHANGE_PASSWORD_ERROR:", e);
// // //     return res.status(500).json({ message: "Failed to change password" });
// // //   }
// // // }

// // // module.exports = {
// // //   register,
// // //   login,
// // //   firebaseAuth,
// // //   changePassword,
// // // };






// // // controllers/authController.js
// // const jwt = require("jsonwebtoken");
// // const User = require("../models/User");
// // const Student = require("../models/Student");
// // const Vendor = require("../models/Vendor");
// // const Sponsor = require("../models/Sponsor");
// // const DeliveryPersonnel = require("../models/DeliveryPersonnel");
// // const admin = require("../config/firebaseAdmin");

// // function signToken(userId) {
// //   return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
// // }

// // function dashboardUrlForRole(role) {
// //   const r = String(role || "").toLowerCase();

// //   if (r === "admin") return "/admin/dashboard";
// //   if (r === "student") return "/student/dashboard";
// //   if (r === "vendor") return "/vendor/dashboard";
// //   if (r === "sponsor") return "/sponsor/dashboard";
// //   if (r === "delivery") return "/delivery/dashboard";

// //   return "/";
// // }

// // function cleanString(value) {
// //   return String(value || "").trim();
// // }

// // function isFilled(value) {
// //   return cleanString(value).length > 0;
// // }

// // function isValidKenyanPhone(value) {
// //   return /^07\d{8}$/.test(cleanString(value));
// // }

// // function isValidEmail(value) {
// //   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString(value));
// // }

// // function isReviewOnlyRole(role) {
// //   const r = String(role || "").toLowerCase();
// //   return r === "vendor" || r === "delivery";
// // }

// // async function getRoleProfile(user) {
// //   if (!user?._id || !user?.role) return null;

// //   const role = String(user.role).toLowerCase();

// //   if (role === "student") return Student.findOne({ user: user._id });
// //   if (role === "vendor") return Vendor.findOne({ user: user._id });
// //   if (role === "sponsor") return Sponsor.findOne({ user: user._id });
// //   if (role === "delivery") return DeliveryPersonnel.findOne({ user: user._id });

// //   return null;
// // }

// // function profileIsComplete(role, profile) {
// //   if (role === "admin") return true;
// //   if (!profile) return false;

// //   if (role === "student") {
// //     return (
// //       isFilled(profile.university) &&
// //       isFilled(profile.campus) &&
// //       isFilled(profile.hostel)
// //     );
// //   }

// //   if (role === "vendor") {
// //     return (
// //       isFilled(profile.businessName) &&
// //       isFilled(profile.businessPhone) &&
// //       Array.isArray(profile.locations) &&
// //       profile.locations.length > 0 &&
// //       isFilled(profile.locations[0]?.name) &&
// //       isFilled(profile.locations[0]?.address)
// //     );
// //   }

// //   if (role === "sponsor") {
// //     return (
// //       isFilled(profile.organizationName) &&
// //       isFilled(profile.contactPerson) &&
// //       isFilled(profile.contactPhone)
// //     );
// //   }

// //   if (role === "delivery") {
// //     return (
// //       isFilled(profile.serviceArea) &&
// //       isFilled(profile.transportMode) &&
// //       isFilled(profile.availability)
// //     );
// //   }

// //   return false;
// // }

// // function approvalStatusFor(role, user, profile) {
// //   if (!user?.isApproved) return "pending";

// //   if (role === "vendor") return profile?.approvedStatus || "pending";
// //   if (role === "delivery") return profile?.approvedStatus || "pending";
// //   if (role === "sponsor") return profile?.approvedStatus || "approved";

// //   return "approved";
// // }

// // function buildNavigation(user, profile) {
// //   const role = String(user?.role || "").toLowerCase();
// //   const profileComplete = profileIsComplete(role, profile);
// //   const approvalStatus = approvalStatusFor(role, user, profile);

// //   let nextStep = "dashboard";

// //   if (user?.requiresPasswordChange) {
// //     nextStep = "change_password";
// //   } else if (
// //     !user?.isApproved ||
// //     approvalStatus === "pending" ||
// //     approvalStatus === "rejected"
// //   ) {
// //     nextStep = "pending_approval";
// //   } else if (!profileComplete) {
// //     nextStep = "complete_profile";
// //   }

// //   return {
// //     profileStatus: {
// //       profileComplete,
// //       approvalStatus,
// //       requiresPasswordChange: Boolean(user?.requiresPasswordChange),
// //     },
// //     navigation: {
// //       nextStep,
// //       dashboardUrl: dashboardUrlForRole(role),
// //     },
// //   };
// // }

// // function publicUser(user) {
// //   if (!user) return null;

// //   return {
// //     id: user._id,
// //     name: user.name,
// //     email: user.email,
// //     phone: user.phone || "",
// //     avatar: user.avatar || "",
// //     role: user.role,
// //     isApproved: user.isApproved,
// //     requiresPasswordChange: user.requiresPasswordChange,
// //   };
// // }

// // async function createRoleProfile({ userId, role, profile = {} }) {
// //   if (role === "student") {
// //     return Student.create({
// //       user: userId,

// //       deliveryLocation: profile.deliveryLocation || null,

// //       stellarPublicKey: cleanString(profile.stellarPublicKey),

// //       university: cleanString(profile.university || "Egerton University"),
// //       campus: cleanString(profile.campus || "Njoro Main Campus"),

// //       hostel: cleanString(profile.hostel),
// //       block: cleanString(profile.block),
// //       room: cleanString(profile.room),
// //       landmark: cleanString(profile.landmark),

// //       instructions: cleanString(profile.instructions),
// //       diet: cleanString(profile.diet),
// //       allergies: cleanString(profile.allergies),
// //     });
// //   }

// //   if (role === "vendor") {
// //     return Vendor.create({
// //       user: userId,
// //       stellarPublicKey: cleanString(profile.stellarPublicKey),
// //       businessName: cleanString(profile.businessName),
// //       businessPhone: cleanString(profile.businessPhone),
// //       businessEmail: cleanString(profile.businessEmail),
// //       cuisine: cleanString(profile.cuisine),
// //       approvedStatus: "pending",
// //       locations: [
// //         {
// //           name: cleanString(profile.locationName),
// //           address: cleanString(profile.address || profile.locationName),
// //           hours: cleanString(profile.hours),
// //           status: "Open",
// //         },
// //       ],
// //     });
// //   }

// //   if (role === "sponsor") {
// //     return Sponsor.create({
// //       user: userId,
// //       stellarPublicKey: cleanString(profile.stellarPublicKey),
// //       organizationName: cleanString(profile.organizationName),
// //       contactPerson: cleanString(profile.contactPerson),
// //       contactPhone: cleanString(profile.contactPhone),
// //       sponsorshipType: cleanString(profile.sponsorshipType),
// //       monthlyBudget: Number(profile.monthlyBudget || 0),
// //       approvedStatus: "approved",
// //     });
// //   }

// //   if (role === "delivery") {
// //     return DeliveryPersonnel.create({
// //       user: userId,
// //       assignedVendor: profile.assignedVendor || null,
// //       serviceArea: cleanString(profile.serviceArea),
// //       transportMode: cleanString(profile.transportMode),
// //       availability: cleanString(profile.availability || "Available"),
// //       emergencyContact: cleanString(profile.emergencyContact || profile.contact),
// //       approvedStatus: "pending",
// //     });
// //   }

// //   return null;
// // }

// // function validateRegistrationPayload({
// //   name,
// //   email,
// //   phone,
// //   password,
// //   role,
// //   profile,
// // }) {
// //   if (!name || !email || !phone) {
// //     return "Missing required fields";
// //   }

// //   if (!isValidEmail(email)) {
// //     return "Enter a valid email address.";
// //   }

// //   if (!isValidKenyanPhone(phone)) {
// //     return "Phone number must be 10 digits and start with 07.";
// //   }

// //   if (!isReviewOnlyRole(role)) {
// //     if (!password) return "Password is required.";

// //     if (String(password).length < 6) {
// //       return "Password must be at least 6 characters.";
// //     }
// //   }

// //   if (role === "student") {
// //     if (!profile?.deliveryLocation && !isFilled(profile?.hostel)) {
// //       return "Hostel or delivery location is required.";
// //     }
// //   }

// //   if (role === "vendor") {
// //     if (!isFilled(profile?.businessName)) {
// //       return "Business name is required.";
// //     }

// //     if (!isFilled(profile?.locationName) && !isFilled(profile?.address)) {
// //       return "Business location is required.";
// //     }
// //   }

// //   if (role === "sponsor") {
// //     if (!isFilled(profile?.organizationName)) {
// //       return "Sponsor name is required.";
// //     }
// //   }

// //   if (role === "delivery") {
// //     if (!isFilled(profile?.serviceArea)) {
// //       return "Service area is required.";
// //     }

// //     if (!isFilled(profile?.transportMode)) {
// //       return "Transport mode is required.";
// //     }

// //     const contact = profile?.contact || profile?.emergencyContact || phone;

// //     if (!isValidKenyanPhone(contact)) {
// //       return "Contact must be 10 digits and start with 07.";
// //     }
// //   }

// //   return "";
// // }

// // async function register(req, res) {
// //   try {
// //     const {
// //       name,
// //       password,
// //       role = "student",
// //       phone,
// //       profile = {},
// //     } = req.body || {};

// //     const email = req.body?.email?.trim().toLowerCase();
// //     const cleanRole = String(role || "student").toLowerCase().trim();

// //     const allowedPublicRoles = ["student", "vendor", "sponsor", "delivery"];

// //     if (!allowedPublicRoles.includes(cleanRole)) {
// //       return res.status(400).json({
// //         message: "Invalid signup role.",
// //       });
// //     }

// //     const validationMessage = validateRegistrationPayload({
// //       name,
// //       email,
// //       phone,
// //       password,
// //       role: cleanRole,
// //       profile,
// //     });

// //     if (validationMessage) {
// //       return res.status(400).json({ message: validationMessage });
// //     }

// //     const exists = await User.findOne({ email });

// //     if (exists) {
// //       return res.status(409).json({ message: "Email already in use" });
// //     }

// //     const reviewOnly = isReviewOnlyRole(cleanRole);

// //     const userPayload = {
// //       name: cleanString(name),
// //       email,
// //       phone: cleanString(phone),
// //       role: cleanRole,
// //       isApproved: reviewOnly ? false : true,
// //       requiresPasswordChange: reviewOnly ? true : false,
// //     };

// //     if (!reviewOnly) {
// //       userPayload.password = password;
// //     }

// //     const user = await User.create(userPayload);

// //     const roleProfile = await createRoleProfile({
// //       userId: user._id,
// //       role: cleanRole,
// //       profile: profile || {},
// //     });

// //     const safeUser = await User.findById(user._id).select("-password");

// //     if (reviewOnly) {
// //       return res.status(201).json({
// //         token: "",
// //         user: publicUser(safeUser),
// //         profileStatus: {
// //           profileComplete: profileIsComplete(cleanRole, roleProfile),
// //           approvalStatus: "pending",
// //           requiresPasswordChange: true,
// //         },
// //         navigation: {
// //           nextStep: "application_submitted",
// //           dashboardUrl: "/",
// //         },
// //         message:
// //           "Application submitted successfully. Your account will be reviewed, and once approved, your login credentials will be mailed to you.",
// //       });
// //     }

// //     const token = signToken(user._id);
// //     const nav = buildNavigation(safeUser, roleProfile);

// //     return res.status(201).json({
// //       token,
// //       user: publicUser(safeUser),
// //       profileStatus: nav.profileStatus,
// //       navigation: nav.navigation,
// //       message: "Account created successfully.",
// //     });
// //   } catch (e) {
// //     console.error("REGISTER_ERROR:", e);
// //     return res.status(500).json({ message: "Signup failed" });
// //   }
// // }

// // async function login(req, res) {
// //   try {
// //     const { password } = req.body || {};
// //     const email = req.body?.email?.trim().toLowerCase();

// //     if (!email || !password) {
// //       return res.status(400).json({ message: "Missing fields" });
// //     }

// //     const user = await User.findOne({ email }).select("+password");

// //     if (!user) {
// //       return res.status(401).json({ message: "Invalid credentials" });
// //     }

// //     if (!user.isApproved) {
// //       return res.status(403).json({
// //         message:
// //           "Account pending approval. Once approved, your login credentials will be mailed to you.",
// //       });
// //     }

// //     if (!user.password) {
// //       return res.status(403).json({
// //         message:
// //           "Login credentials are not active yet. Please wait for approval email.",
// //       });
// //     }

// //     const ok = await user.matchPassword(password);

// //     if (!ok) {
// //       return res.status(401).json({ message: "Invalid credentials" });
// //     }

// //     const roleProfile = await getRoleProfile(user);
// //     const safeUser = await User.findById(user._id).select("-password");
// //     const nav = buildNavigation(safeUser, roleProfile);

// //     const token = signToken(user._id);

// //     return res.json({
// //       token,
// //       user: publicUser(safeUser),
// //       profileStatus: nav.profileStatus,
// //       navigation: nav.navigation,
// //       requiresPasswordChange: safeUser.requiresPasswordChange,
// //     });
// //   } catch (e) {
// //     console.error("LOGIN_ERROR:", e);
// //     return res.status(500).json({ message: "Login failed" });
// //   }
// // }

// // async function firebaseAuth(req, res) {
// //   try {
// //     const { idToken, role } = req.body || {};

// //     if (!idToken) {
// //       return res.status(400).json({ message: "Missing idToken" });
// //     }

// //     let decoded;

// //     try {
// //       decoded = await admin.auth().verifyIdToken(idToken);
// //     } catch (verifyError) {
// //       console.error("FIREBASE_VERIFY_TOKEN_ERROR:", {
// //         code: verifyError.code,
// //         message: verifyError.message,
// //       });

// //       return res.status(401).json({
// //         message: "Firebase token verification failed",
// //         error:
// //           process.env.NODE_ENV === "production"
// //             ? undefined
// //             : verifyError.message,
// //         code:
// //           process.env.NODE_ENV === "production"
// //             ? undefined
// //             : verifyError.code,
// //       });
// //     }

// //     const firebaseUid = decoded.uid;
// //     const email = cleanString(decoded.email).toLowerCase();
// //     const name = cleanString(decoded.name || decoded.email || "User");
// //     const avatar = cleanString(decoded.picture);

// //     if (!firebaseUid) {
// //       return res.status(401).json({ message: "Firebase token has no uid" });
// //     }

// //     if (!email) {
// //       return res.status(400).json({
// //         message:
// //           "Your Google account did not provide an email. Please use another Google account.",
// //       });
// //     }

// //     let user = await User.findOne({ firebaseUid });

// //     if (!user) {
// //       user = await User.findOne({ email });

// //       if (user) {
// //         user.firebaseUid = firebaseUid;

// //         if (!user.avatar && avatar) user.avatar = avatar;
// //         if (!user.name && name) user.name = name;

// //         await user.save();
// //       }
// //     }

// //     if (!user) {
// //       const cleanRole = String(role || "student").toLowerCase().trim();

// //       // Do not allow vendor, delivery, or admin creation through public Google signup.
// //       const finalRole = ["student", "sponsor"].includes(cleanRole)
// //         ? cleanRole
// //         : "student";

// //       const randomPassword =
// //         Math.random().toString(36).slice(2) +
// //         Math.random().toString(36).slice(2) +
// //         Date.now().toString(36);

// //       const userPayload = {
// //         firebaseUid,
// //         email,
// //         name,
// //         avatar,
// //         role: finalRole,
// //         isApproved: true,
// //         requiresPasswordChange: false,

// //         /*
// //           If your User model still requires password, this prevents validation failure.
// //           Google users should not normally use this password.
// //         */
// //         password: randomPassword,
// //       };

// //       /*
// //         If your User model requires phone, this may still fail if phone is required
// //         and empty strings are rejected. Best long-term fix is to make phone optional
// //         for Firebase users in the User model.
// //       */
// //       if (req.body?.phone) {
// //         userPayload.phone = cleanString(req.body.phone);
// //       } else {
// //         userPayload.phone = "";
// //       }

// //       try {
// //         user = await User.create(userPayload);
// //       } catch (createUserError) {
// //         console.error("FIREBASE_CREATE_USER_ERROR:", {
// //           name: createUserError.name,
// //           code: createUserError.code,
// //           message: createUserError.message,
// //           errors: createUserError.errors,
// //         });

// //         return res.status(500).json({
// //           message: "Google account verified, but user creation failed",
// //           error:
// //             process.env.NODE_ENV === "production"
// //               ? undefined
// //               : createUserError.message,
// //           errors:
// //             process.env.NODE_ENV === "production"
// //               ? undefined
// //               : createUserError.errors,
// //         });
// //       }

// //       try {
// //         await createRoleProfile({
// //           userId: user._id,
// //           role: user.role,
// //           profile:
// //             user.role === "student"
// //               ? {
// //                   university: "Egerton University",
// //                   campus: "Njoro Main Campus",
// //                   hostel: "",
// //                   block: "",
// //                   room: "",
// //                   landmark: "",
// //                 }
// //               : user.role === "sponsor"
// //               ? {
// //                   organizationName: user.name,
// //                   contactPerson: user.name,
// //                   contactPhone: user.phone || "",
// //                   sponsorshipType: "",
// //                   monthlyBudget: 0,
// //                 }
// //               : {},
// //         });
// //       } catch (profileError) {
// //         console.error("FIREBASE_CREATE_PROFILE_ERROR:", {
// //           name: profileError.name,
// //           code: profileError.code,
// //           message: profileError.message,
// //           errors: profileError.errors,
// //         });

// //         /*
// //           Do not block login if profile creation fails.
// //           buildNavigation will send the user to complete_profile if profile is missing.
// //         */
// //       }
// //     }

// //     if (!user.isApproved) {
// //       return res.status(403).json({
// //         message:
// //           "Account pending approval. Once approved, your login credentials will be mailed to you.",
// //       });
// //     }

// //     const roleProfile = await getRoleProfile(user);
// //     const safeUser = await User.findById(user._id).select("-password");
// //     const nav = buildNavigation(safeUser, roleProfile);

// //     const token = signToken(user._id);

// //     return res.json({
// //       token,
// //       user: publicUser(safeUser),
// //       profileStatus: nav.profileStatus,
// //       navigation: nav.navigation,
// //       requiresPasswordChange: safeUser.requiresPasswordChange,
// //     });
// //   } catch (e) {
// //     console.error("FIREBASE_AUTH_ERROR:", {
// //       name: e.name,
// //       code: e.code,
// //       message: e.message,
// //       stack: e.stack,
// //     });

// //     return res.status(500).json({
// //       message: "Google authentication failed on backend",
// //       error: process.env.NODE_ENV === "production" ? undefined : e.message,
// //       code: process.env.NODE_ENV === "production" ? undefined : e.code,
// //     });
// //   }
// // }

// // async function changePassword(req, res) {
// //   try {
// //     const { userId, oldPassword, newPassword } = req.body;

// //     if (!userId || !oldPassword || !newPassword) {
// //       return res.status(400).json({ message: "Missing fields" });
// //     }

// //     if (newPassword.length < 6) {
// //       return res.status(400).json({
// //         message: "New password must be at least 6 characters.",
// //       });
// //     }

// //     const user = await User.findById(userId).select("+password");

// //     if (!user) {
// //       return res.status(404).json({ message: "User not found" });
// //     }

// //     const ok = await user.matchPassword(oldPassword);

// //     if (!ok) {
// //       return res.status(401).json({ message: "Invalid old password" });
// //     }

// //     user.password = newPassword;
// //     user.requiresPasswordChange = false;

// //     await user.save();

// //     return res.json({ message: "Password updated successfully" });
// //   } catch (e) {
// //     console.error("CHANGE_PASSWORD_ERROR:", e);
// //     return res.status(500).json({ message: "Failed to change password" });
// //   }
// // }

// // module.exports = {
// //   register,
// //   login,
// //   firebaseAuth,
// //   changePassword,
// // };



// // controllers/authController.js
// const jwt = require("jsonwebtoken");
// const User = require("../models/User");
// const Student = require("../models/Student");
// const Vendor = require("../models/Vendor");
// const Sponsor = require("../models/Sponsor");
// const DeliveryPersonnel = require("../models/DeliveryPersonnel");
// const admin = require("../config/firebaseAdmin");

// function signToken(userId) {
//   return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
// }

// function dashboardUrlForRole(role) {
//   const r = String(role || "").toLowerCase();

//   if (r === "admin") return "/admin/dashboard";
//   if (r === "student") return "/student/dashboard";
//   if (r === "vendor") return "/vendor/dashboard";
//   if (r === "sponsor") return "/sponsor/dashboard";
//   if (r === "delivery") return "/delivery/dashboard";

//   return "/";
// }

// function cleanString(value) {
//   return String(value || "").trim();
// }

// function isFilled(value) {
//   return cleanString(value).length > 0;
// }

// function isValidKenyanPhone(value) {
//   return /^07\d{8}$/.test(cleanString(value));
// }

// function isValidEmail(value) {
//   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString(value));
// }

// function isReviewOnlyRole(role) {
//   const r = String(role || "").toLowerCase();
//   return r === "vendor" || r === "delivery";
// }

// async function getRoleProfile(user) {
//   if (!user?._id || !user?.role) return null;

//   const role = String(user.role).toLowerCase();

//   if (role === "student") return Student.findOne({ user: user._id });
//   if (role === "vendor") return Vendor.findOne({ user: user._id });
//   if (role === "sponsor") return Sponsor.findOne({ user: user._id });
//   if (role === "delivery") return DeliveryPersonnel.findOne({ user: user._id });

//   return null;
// }

// function profileIsComplete(role, profile) {
//   if (role === "admin") return true;
//   if (!profile) return false;

//   if (role === "student") {
//     return (
//       isFilled(profile.university) &&
//       isFilled(profile.campus) &&
//       isFilled(profile.hostel)
//     );
//   }

//   if (role === "vendor") {
//     return (
//       isFilled(profile.businessName) &&
//       isFilled(profile.businessPhone) &&
//       Array.isArray(profile.locations) &&
//       profile.locations.length > 0 &&
//       isFilled(profile.locations[0]?.name) &&
//       isFilled(profile.locations[0]?.address)
//     );
//   }

//   if (role === "sponsor") {
//     return (
//       isFilled(profile.organizationName) &&
//       isFilled(profile.contactPerson) &&
//       isFilled(profile.contactPhone)
//     );
//   }

//   if (role === "delivery") {
//     return (
//       isFilled(profile.serviceArea) &&
//       isFilled(profile.transportMode) &&
//       isFilled(profile.availability)
//     );
//   }

//   return false;
// }

// function approvalStatusFor(role, user, profile) {
//   if (!user?.isApproved) return "pending";

//   if (role === "vendor") return profile?.approvedStatus || "pending";
//   if (role === "delivery") return profile?.approvedStatus || "pending";
//   if (role === "sponsor") return profile?.approvedStatus || "approved";

//   return "approved";
// }

// function buildNavigation(user, profile) {
//   const role = String(user?.role || "").toLowerCase();
//   const profileComplete = profileIsComplete(role, profile);
//   const approvalStatus = approvalStatusFor(role, user, profile);

//   let nextStep = "dashboard";

//   if (user?.requiresPasswordChange) {
//     nextStep = "change_password";
//   } else if (
//     !user?.isApproved ||
//     approvalStatus === "pending" ||
//     approvalStatus === "rejected"
//   ) {
//     nextStep = "pending_approval";
//   } else if (!profileComplete) {
//     nextStep = "complete_profile";
//   }

//   return {
//     profileStatus: {
//       profileComplete,
//       approvalStatus,
//       requiresPasswordChange: Boolean(user?.requiresPasswordChange),
//     },
//     navigation: {
//       nextStep,
//       dashboardUrl: dashboardUrlForRole(role),
//     },
//   };
// }

// function publicUser(user) {
//   if (!user) return null;

//   return {
//     id: user._id,
//     name: user.name,
//     email: user.email,
//     phone: user.phone || "",
//     avatar: user.avatar || "",
//     role: user.role,
//     isApproved: user.isApproved,
//     requiresPasswordChange: user.requiresPasswordChange,
//   };
// }

// async function createRoleProfile({ userId, role, profile = {} }) {
//   if (role === "student") {
//     return Student.create({
//       user: userId,

//       deliveryLocation: profile.deliveryLocation || null,

//       stellarPublicKey: cleanString(profile.stellarPublicKey),

//       university: cleanString(profile.university || "Egerton University"),
//       campus: cleanString(profile.campus || "Njoro Main Campus"),

//       hostel: cleanString(profile.hostel),
//       block: cleanString(profile.block),
//       room: cleanString(profile.room),
//       landmark: cleanString(profile.landmark),

//       instructions: cleanString(profile.instructions),
//       diet: cleanString(profile.diet),
//       allergies: cleanString(profile.allergies),
//     });
//   }

//   if (role === "vendor") {
//     return Vendor.create({
//       user: userId,
//       stellarPublicKey: cleanString(profile.stellarPublicKey),
//       businessName: cleanString(profile.businessName),
//       businessPhone: cleanString(profile.businessPhone),
//       businessEmail: cleanString(profile.businessEmail),
//       cuisine: cleanString(profile.cuisine),
//       approvedStatus: "pending",
//       locations: [
//         {
//           name: cleanString(profile.locationName),
//           address: cleanString(profile.address || profile.locationName),
//           hours: cleanString(profile.hours),
//           status: "Open",
//         },
//       ],
//     });
//   }

//   if (role === "sponsor") {
//     return Sponsor.create({
//       user: userId,
//       stellarPublicKey: cleanString(profile.stellarPublicKey),
//       organizationName: cleanString(profile.organizationName),
//       contactPerson: cleanString(profile.contactPerson),
//       contactPhone: cleanString(profile.contactPhone),
//       sponsorshipType: cleanString(profile.sponsorshipType),
//       monthlyBudget: Number(profile.monthlyBudget || 0),
//       approvedStatus: "approved",
//     });
//   }

//   if (role === "delivery") {
//     return DeliveryPersonnel.create({
//       user: userId,
//       assignedVendor: profile.assignedVendor || null,
//       serviceArea: cleanString(profile.serviceArea),
//       transportMode: cleanString(profile.transportMode),
//       availability: cleanString(profile.availability || "Available"),
//       emergencyContact: cleanString(profile.emergencyContact || profile.contact),
//       approvedStatus: "pending",
//     });
//   }

//   return null;
// }

// function validateRegistrationPayload({
//   name,
//   email,
//   phone,
//   password,
//   role,
//   profile,
// }) {
//   if (!name || !email || !phone) {
//     return "Missing required fields";
//   }

//   if (!isValidEmail(email)) {
//     return "Enter a valid email address.";
//   }

//   if (!isValidKenyanPhone(phone)) {
//     return "Phone number must be 10 digits and start with 07.";
//   }

//   if (!isReviewOnlyRole(role)) {
//     if (!password) return "Password is required.";

//     if (String(password).length < 6) {
//       return "Password must be at least 6 characters.";
//     }
//   }

//   if (role === "student") {
//     if (!profile?.deliveryLocation && !isFilled(profile?.hostel)) {
//       return "Hostel or delivery location is required.";
//     }
//   }

//   if (role === "vendor") {
//     if (!isFilled(profile?.businessName)) {
//       return "Business name is required.";
//     }

//     if (!isFilled(profile?.locationName) && !isFilled(profile?.address)) {
//       return "Business location is required.";
//     }
//   }

//   if (role === "sponsor") {
//     if (!isFilled(profile?.organizationName)) {
//       return "Sponsor name is required.";
//     }
//   }

//   if (role === "delivery") {
//     if (!isFilled(profile?.serviceArea)) {
//       return "Service area is required.";
//     }

//     if (!isFilled(profile?.transportMode)) {
//       return "Transport mode is required.";
//     }

//     const contact = profile?.contact || profile?.emergencyContact || phone;

//     if (!isValidKenyanPhone(contact)) {
//       return "Contact must be 10 digits and start with 07.";
//     }
//   }

//   return "";
// }

// async function register(req, res) {
//   try {
//     const {
//       name,
//       password,
//       role = "student",
//       phone,
//       profile = {},
//     } = req.body || {};

//     const email = req.body?.email?.trim().toLowerCase();
//     const cleanRole = String(role || "student").toLowerCase().trim();

//     const allowedPublicRoles = ["student", "vendor", "sponsor", "delivery"];

//     if (!allowedPublicRoles.includes(cleanRole)) {
//       return res.status(400).json({
//         message: "Invalid signup role.",
//       });
//     }

//     const validationMessage = validateRegistrationPayload({
//       name,
//       email,
//       phone,
//       password,
//       role: cleanRole,
//       profile,
//     });

//     if (validationMessage) {
//       return res.status(400).json({ message: validationMessage });
//     }

//     const exists = await User.findOne({ email });

//     if (exists) {
//       return res.status(409).json({ message: "Email already in use" });
//     }

//     const reviewOnly = isReviewOnlyRole(cleanRole);

//     const userPayload = {
//       name: cleanString(name),
//       email,
//       phone: cleanString(phone),
//       role: cleanRole,
//       isApproved: reviewOnly ? false : true,
//       requiresPasswordChange: reviewOnly ? true : false,
//     };

//     if (!reviewOnly) {
//       userPayload.password = password;
//     }

//     const user = await User.create(userPayload);

//     const roleProfile = await createRoleProfile({
//       userId: user._id,
//       role: cleanRole,
//       profile: profile || {},
//     });

//     const safeUser = await User.findById(user._id).select("-password");

//     if (reviewOnly) {
//       return res.status(201).json({
//         token: "",
//         user: publicUser(safeUser),
//         profileStatus: {
//           profileComplete: profileIsComplete(cleanRole, roleProfile),
//           approvalStatus: "pending",
//           requiresPasswordChange: true,
//         },
//         navigation: {
//           nextStep: "application_submitted",
//           dashboardUrl: "/",
//         },
//         message:
//           "Application submitted successfully. Your account will be reviewed, and once approved, your login credentials will be mailed to you.",
//       });
//     }

//     const token = signToken(user._id);
//     const nav = buildNavigation(safeUser, roleProfile);

//     return res.status(201).json({
//       token,
//       user: publicUser(safeUser),
//       profileStatus: nav.profileStatus,
//       navigation: nav.navigation,
//       message: "Account created successfully.",
//     });
//   } catch (e) {
//     console.error("REGISTER_ERROR:", e);
//     return res.status(500).json({ message: "Signup failed" });
//   }
// }

// async function login(req, res) {
//   try {
//     const { password } = req.body || {};
//     const email = req.body?.email?.trim().toLowerCase();

//     if (!email || !password) {
//       return res.status(400).json({ message: "Missing fields" });
//     }

//     const user = await User.findOne({ email }).select("+password");

//     if (!user) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     if (!user.isApproved) {
//       return res.status(403).json({
//         message:
//           "Account pending approval. Once approved, your login credentials will be mailed to you.",
//       });
//     }

//     if (!user.password) {
//       return res.status(403).json({
//         message:
//           "Login credentials are not active yet. Please wait for approval email.",
//       });
//     }

//     const ok = await user.matchPassword(password);

//     if (!ok) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     const roleProfile = await getRoleProfile(user);
//     const safeUser = await User.findById(user._id).select("-password");
//     const nav = buildNavigation(safeUser, roleProfile);

//     const token = signToken(user._id);

//     return res.json({
//       token,
//       user: publicUser(safeUser),
//       profileStatus: nav.profileStatus,
//       navigation: nav.navigation,
//       requiresPasswordChange: safeUser.requiresPasswordChange,
//     });
//   } catch (e) {
//     console.error("LOGIN_ERROR:", e);
//     return res.status(500).json({ message: "Login failed" });
//   }
// }

// async function firebaseAuth(req, res) {
//   try {
//     const { idToken, role } = req.body || {};

//     if (!idToken) {
//       return res.status(400).json({ message: "Missing idToken" });
//     }

//     let decoded;

//     try {
//       decoded = await admin.auth().verifyIdToken(idToken);
//     } catch (verifyError) {
//       console.error("FIREBASE_VERIFY_TOKEN_ERROR:", {
//         code: verifyError.code,
//         message: verifyError.message,
//       });

//       return res.status(401).json({
//         message: "Firebase token verification failed",
//         error:
//           process.env.NODE_ENV === "production"
//             ? undefined
//             : verifyError.message,
//         code:
//           process.env.NODE_ENV === "production"
//             ? undefined
//             : verifyError.code,
//       });
//     }

//     const firebaseUid = decoded.uid;
//     const email = cleanString(decoded.email).toLowerCase();
//     const name = cleanString(decoded.name || decoded.email || "User");
//     const avatar = cleanString(decoded.picture);

//     if (!firebaseUid) {
//       return res.status(401).json({ message: "Firebase token has no uid" });
//     }

//     if (!email) {
//       return res.status(400).json({
//         message:
//           "Your Google account did not provide an email. Please use another Google account.",
//       });
//     }

//     let user = await User.findOne({ firebaseUid });

//     if (!user) {
//       user = await User.findOne({ email });

//       if (user) {
//         user.firebaseUid = firebaseUid;

//         if (!user.avatar && avatar) user.avatar = avatar;
//         if (!user.name && name) user.name = name;

//         await user.save();
//       }
//     }

//     if (!user) {
//       const cleanRole = String(role || "student").toLowerCase().trim();

//       const finalRole = ["student", "sponsor"].includes(cleanRole)
//         ? cleanRole
//         : "student";

//       const randomPassword =
//         Math.random().toString(36).slice(2) +
//         Math.random().toString(36).slice(2) +
//         Date.now().toString(36);

//       const userPayload = {
//         firebaseUid,
//         email,
//         name,
//         avatar,
//         role: finalRole,
//         isApproved: true,
//         requiresPasswordChange: false,
//         password: randomPassword,
//         phone: req.body?.phone ? cleanString(req.body.phone) : "",
//       };

//       try {
//         user = await User.create(userPayload);
//       } catch (createUserError) {
//         console.error("FIREBASE_CREATE_USER_ERROR:", {
//           name: createUserError.name,
//           code: createUserError.code,
//           message: createUserError.message,
//           errors: createUserError.errors,
//         });

//         return res.status(500).json({
//           message: "Google account verified, but user creation failed",
//           error:
//             process.env.NODE_ENV === "production"
//               ? undefined
//               : createUserError.message,
//           errors:
//             process.env.NODE_ENV === "production"
//               ? undefined
//               : createUserError.errors,
//         });
//       }

//       try {
//         await createRoleProfile({
//           userId: user._id,
//           role: user.role,
//           profile:
//             user.role === "student"
//               ? {
//                   university: "Egerton University",
//                   campus: "Njoro Main Campus",
//                   hostel: "",
//                   block: "",
//                   room: "",
//                   landmark: "",
//                 }
//               : user.role === "sponsor"
//               ? {
//                   organizationName: user.name,
//                   contactPerson: user.name,
//                   contactPhone: user.phone || "",
//                   sponsorshipType: "",
//                   monthlyBudget: 0,
//                 }
//               : {},
//         });
//       } catch (profileError) {
//         console.error("FIREBASE_CREATE_PROFILE_ERROR:", {
//           name: profileError.name,
//           code: profileError.code,
//           message: profileError.message,
//           errors: profileError.errors,
//         });
//       }
//     }

//     if (!user.isApproved) {
//       return res.status(403).json({
//         message:
//           "Account pending approval. Once approved, your login credentials will be mailed to you.",
//       });
//     }

//     const roleProfile = await getRoleProfile(user);
//     const safeUser = await User.findById(user._id).select("-password");
//     const nav = buildNavigation(safeUser, roleProfile);

//     const token = signToken(user._id);

//     return res.json({
//       token,
//       user: publicUser(safeUser),
//       profileStatus: nav.profileStatus,
//       navigation: nav.navigation,
//       requiresPasswordChange: safeUser.requiresPasswordChange,
//     });
//   } catch (e) {
//     console.error("FIREBASE_AUTH_ERROR:", {
//       name: e.name,
//       code: e.code,
//       message: e.message,
//       stack: e.stack,
//     });

//     return res.status(500).json({
//       message: "Google authentication failed on backend",
//       error: process.env.NODE_ENV === "production" ? undefined : e.message,
//       code: process.env.NODE_ENV === "production" ? undefined : e.code,
//     });
//   }
// }

// async function me(req, res) {
//   try {
//     const userId = req.user?.id || req.user?._id || req.user?.sub;

//     if (!userId) {
//       return res.status(401).json({ message: "Unauthorized" });
//     }

//     const user = await User.findById(userId).select("-password");

//     if (!user) {
//       return res.status(401).json({ message: "User not found" });
//     }

//     const roleProfile = await getRoleProfile(user);
//     const nav = buildNavigation(user, roleProfile);

//     return res.json({
//       user: publicUser(user),
//       profileStatus: nav.profileStatus,
//       navigation: nav.navigation,
//     });
//   } catch (e) {
//     console.error("ME_ERROR:", e);
//     return res.status(500).json({ message: "Failed to fetch user" });
//   }
// }

// async function changePassword(req, res) {
//   try {
//     const { userId, oldPassword, newPassword } = req.body;

//     if (!userId || !oldPassword || !newPassword) {
//       return res.status(400).json({ message: "Missing fields" });
//     }

//     if (newPassword.length < 6) {
//       return res.status(400).json({
//         message: "New password must be at least 6 characters.",
//       });
//     }

//     const user = await User.findById(userId).select("+password");

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const ok = await user.matchPassword(oldPassword);

//     if (!ok) {
//       return res.status(401).json({ message: "Invalid old password" });
//     }

//     user.password = newPassword;
//     user.requiresPasswordChange = false;

//     await user.save();

//     return res.json({ message: "Password updated successfully" });
//   } catch (e) {
//     console.error("CHANGE_PASSWORD_ERROR:", e);
//     return res.status(500).json({ message: "Failed to change password" });
//   }
// }

// module.exports = {
//   register,
//   login,
//   firebaseAuth,
//   changePassword,
//   me,
// };








// controllers/authController.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Student = require("../models/Student");
const Vendor = require("../models/Vendor");
const Sponsor = require("../models/Sponsor");
const DeliveryPersonnel = require("../models/DeliveryPersonnel");
const admin = require("../config/firebaseAdmin");

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function dashboardUrlForRole(role) {
  const r = String(role || "").toLowerCase();

  if (r === "admin") return "/admin/dashboard";
  if (r === "student") return "/student/dashboard";
  if (r === "vendor") return "/vendor/dashboard";
  if (r === "sponsor") return "/sponsor/dashboard";
  if (r === "delivery") return "/delivery/dashboard";

  return "/";
}

function cleanString(value) {
  return String(value || "").trim();
}

function isFilled(value) {
  return cleanString(value).length > 0;
}

function isValidKenyanPhone(value) {
  return /^(?:07|01)\d{8}$/.test(cleanString(value));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString(value));
}

function isReviewOnlyRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "vendor" || r === "delivery";
}

async function getRoleProfile(user) {
  if (!user?._id || !user?.role) return null;

  const role = String(user.role).toLowerCase();

  if (role === "student") return Student.findOne({ user: user._id });
  if (role === "vendor") return Vendor.findOne({ user: user._id });
  if (role === "sponsor") return Sponsor.findOne({ user: user._id });
  if (role === "delivery") return DeliveryPersonnel.findOne({ user: user._id });

  return null;
}

function profileIsComplete(role, profile, user = null) {
  if (role === "admin") return true;
  if (!profile) return false;

  if (role === "student") {
    return (
      isFilled(user?.phone) &&
      isFilled(profile.university) &&
      isFilled(profile.campus) &&
      isFilled(profile.hostel)
    );
  }

  if (role === "vendor") {
    return (
      isFilled(profile.businessName) &&
      isFilled(profile.businessPhone) &&
      Array.isArray(profile.locations) &&
      profile.locations.length > 0 &&
      isFilled(profile.locations[0]?.name) &&
      isFilled(profile.locations[0]?.address)
    );
  }

  if (role === "sponsor") {
    return (
      isFilled(user?.phone || profile.contactPhone) &&
      isFilled(profile.organizationName)
    );
  }

  if (role === "delivery") {
    return (
      isFilled(profile.serviceArea) &&
      isFilled(profile.transportMode) &&
      isFilled(profile.availability)
    );
  }

  return false;
}

function approvalStatusFor(role, user, profile) {
  if (!user?.isApproved) return "pending";

  if (role === "vendor") return profile?.approvedStatus || "pending";
  if (role === "delivery") return profile?.approvedStatus || "pending";
  if (role === "sponsor") return profile?.approvedStatus || "approved";

  return "approved";
}

function buildNavigation(user, profile) {
  const role = String(user?.role || "").toLowerCase();

  // ✅ Now checks phone from user as part of profile completion
  const profileComplete = profileIsComplete(role, profile, user);

  const approvalStatus = approvalStatusFor(role, user, profile);

  let nextStep = "dashboard";

  if (user?.requiresPasswordChange) {
    nextStep = "change_password";
  } else if (
    !user?.isApproved ||
    approvalStatus === "pending" ||
    approvalStatus === "rejected"
  ) {
    nextStep = "pending_approval";
  } else if (!profileComplete) {
    if (role === "student" || role === "sponsor") {
      nextStep = "complete_profile";
    }
  }

  return {
    profileStatus: {
      profileComplete,
      approvalStatus,
      requiresPasswordChange: Boolean(user?.requiresPasswordChange),
    },
    navigation: {
      nextStep,
      dashboardUrl: dashboardUrlForRole(role),
    },
  };
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    avatar: user.avatar || "",
    role: user.role,
    isApproved: user.isApproved,
    requiresPasswordChange: user.requiresPasswordChange,
  };
}

async function createRoleProfile({ userId, role, profile = {} }) {
  if (role === "student") {
    return Student.create({
      user: userId,

      deliveryLocation: profile.deliveryLocation || null,

      stellarPublicKey: cleanString(profile.stellarPublicKey),

      university: cleanString(profile.university || "Egerton University"),
      campus: cleanString(profile.campus || "Njoro Main Campus"),

      hostel: cleanString(profile.hostel),
      block: cleanString(profile.block),
      room: cleanString(profile.room),
      landmark: cleanString(profile.landmark),

      instructions: cleanString(profile.instructions),
      diet: cleanString(profile.diet),
      allergies: cleanString(profile.allergies),
    });
  }

  if (role === "vendor") {
    return Vendor.create({
      user: userId,
      stellarPublicKey: cleanString(profile.stellarPublicKey),
      businessName: cleanString(profile.businessName),
      businessPhone: cleanString(profile.businessPhone),
      businessEmail: cleanString(profile.businessEmail),
      cuisine: cleanString(profile.cuisine),
      approvedStatus: "pending",
      locations: [
        {
          name: cleanString(profile.locationName),
          address: cleanString(profile.address || profile.locationName),
          hours: cleanString(profile.hours),
          status: "Open",
        },
      ],
    });
  }

  if (role === "sponsor") {
    return Sponsor.create({
      user: userId,
      stellarPublicKey: cleanString(profile.stellarPublicKey),
      organizationName: cleanString(profile.organizationName),
      contactPerson: cleanString(profile.contactPerson),
      contactPhone: cleanString(profile.contactPhone),
      sponsorshipType: cleanString(profile.sponsorshipType),
      monthlyBudget: Number(profile.monthlyBudget || 0),
      approvedStatus: "approved",
    });
  }

  if (role === "delivery") {
    return DeliveryPersonnel.create({
      user: userId,
      assignedVendor: profile.assignedVendor || null,
      serviceArea: cleanString(profile.serviceArea),
      transportMode: cleanString(profile.transportMode),
      availability: cleanString(profile.availability || "Available"),
      emergencyContact: cleanString(profile.emergencyContact || profile.contact),
      approvedStatus: "pending",
    });
  }

  return null;
}

function validateRegistrationPayload({
  name,
  email,
  phone,
  password,
  role,
  profile,
}) {
  if (!name || !email || !phone) {
    return "Missing required fields";
  }

  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }

  if (!isValidKenyanPhone(phone)) {
    return "Phone number must be 10 digits and start with 07 or 01.";
  }

  if (!isReviewOnlyRole(role)) {
    if (!password) return "Password is required.";

    if (String(password).length < 6) {
      return "Password must be at least 6 characters.";
    }
  }

  if (role === "student") {
    if (!profile?.deliveryLocation && !isFilled(profile?.hostel)) {
      return "Hostel or delivery location is required.";
    }
  }

  if (role === "vendor") {
    if (!isFilled(profile?.businessName)) {
      return "Business name is required.";
    }

    if (!isFilled(profile?.locationName) && !isFilled(profile?.address)) {
      return "Business location is required.";
    }
  }

  if (role === "sponsor") {
    if (!isFilled(profile?.organizationName)) {
      return "Sponsor name is required.";
    }
  }

  if (role === "delivery") {
    if (!isFilled(profile?.serviceArea)) {
      return "Service area is required.";
    }

    if (!isFilled(profile?.transportMode)) {
      return "Transport mode is required.";
    }

    const contact = profile?.contact || profile?.emergencyContact || phone;

    if (!isValidKenyanPhone(contact)) {
      return "Contact must be 10 digits and start with 07 or 01.";
    }
  }

  return "";
}

async function register(req, res) {
  try {
    const {
      name,
      password,
      role = "student",
      phone,
      profile = {},
    } = req.body || {};

    const email = req.body?.email?.trim().toLowerCase();
    const cleanRole = String(role || "student").toLowerCase().trim();

    const allowedPublicRoles = ["student", "vendor", "sponsor", "delivery"];

    if (!allowedPublicRoles.includes(cleanRole)) {
      return res.status(400).json({
        message: "Invalid signup role.",
      });
    }

    const validationMessage = validateRegistrationPayload({
      name,
      email,
      phone,
      password,
      role: cleanRole,
      profile,
    });

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const exists = await User.findOne({ email });

    if (exists) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const phoneExists = await User.findOne({ phone: cleanString(phone) });

    if (phoneExists) {
      return res.status(409).json({ message: "Phone number already in use" });
    }

    const reviewOnly = isReviewOnlyRole(cleanRole);

    const userPayload = {
      name: cleanString(name),
      email,
      phone: cleanString(phone),
      role: cleanRole,
      isApproved: reviewOnly ? false : true,
      requiresPasswordChange: reviewOnly ? true : false,
    };

    if (!reviewOnly) {
      userPayload.password = password;
    }

    const user = await User.create(userPayload);

    const roleProfile = await createRoleProfile({
      userId: user._id,
      role: cleanRole,
      profile: profile || {},
    });

    const safeUser = await User.findById(user._id).select("-password");

    if (reviewOnly) {
      return res.status(201).json({
        token: "",
        user: publicUser(safeUser),
        profileStatus: {
          profileComplete: profileIsComplete(cleanRole, roleProfile, safeUser),
          approvalStatus: "pending",
          requiresPasswordChange: true,
        },
        navigation: {
          nextStep: "application_submitted",
          dashboardUrl: "/",
        },
        message:
          "Application submitted successfully. Your account will be reviewed, and once approved, your login credentials will be mailed to you.",
      });
    }

    const token = signToken(user._id);
    const nav = buildNavigation(safeUser, roleProfile);

    return res.status(201).json({
      token,
      user: publicUser(safeUser),
      profileStatus: nav.profileStatus,
      navigation: nav.navigation,
      message: "Account created successfully.",
    });
  } catch (e) {
    console.error("REGISTER_ERROR:", e);
    return res.status(500).json({ message: "Signup failed" });
  }
}

async function login(req, res) {
  try {
    const { password } = req.body || {};
    const email = req.body?.email?.trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.isApproved) {
      return res.status(403).json({
        message:
          "Account pending approval. Once approved, your login credentials will be mailed to you.",
      });
    }

    if (!user.password) {
      return res.status(403).json({
        message:
          "Login credentials are not active yet. Please wait for approval email.",
      });
    }

    const ok = await user.matchPassword(password);

    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const roleProfile = await getRoleProfile(user);
    const safeUser = await User.findById(user._id).select("-password");
    const nav = buildNavigation(safeUser, roleProfile);

    const token = signToken(user._id);

    return res.json({
      token,
      user: publicUser(safeUser),
      profileStatus: nav.profileStatus,
      navigation: nav.navigation,
      requiresPasswordChange: safeUser.requiresPasswordChange,
    });
  } catch (e) {
    console.error("LOGIN_ERROR:", e);
    return res.status(500).json({ message: "Login failed" });
  }
}

async function firebaseAuth(req, res) {
  try {
    const { idToken, role } = req.body || {};

    if (!idToken) {
      return res.status(400).json({ message: "Missing idToken" });
    }

    let decoded;

    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (verifyError) {
      console.error("FIREBASE_VERIFY_TOKEN_ERROR:", {
        code: verifyError.code,
        message: verifyError.message,
      });

      return res.status(401).json({
        message: "Firebase token verification failed",
        error:
          process.env.NODE_ENV === "production"
            ? undefined
            : verifyError.message,
        code:
          process.env.NODE_ENV === "production"
            ? undefined
            : verifyError.code,
      });
    }

    const firebaseUid = decoded.uid;
    const email = cleanString(decoded.email).toLowerCase();
    const name = cleanString(decoded.name || decoded.email || "User");
    const avatar = cleanString(decoded.picture);

    if (!firebaseUid) {
      return res.status(401).json({ message: "Firebase token has no uid" });
    }

    if (!email) {
      return res.status(400).json({
        message:
          "Your Google account did not provide an email. Please use another Google account.",
      });
    }

    let user = await User.findOne({ firebaseUid });

    if (!user) {
      user = await User.findOne({ email });

      if (user) {
        user.firebaseUid = firebaseUid;

        if (!user.avatar && avatar) user.avatar = avatar;
        if (!user.name && name) user.name = name;

        await user.save();
      }
    }

    if (!user) {
      const cleanRole = String(role || "student").toLowerCase().trim();

      const finalRole = ["student", "sponsor"].includes(cleanRole)
        ? cleanRole
        : "student";

      const randomPassword =
        Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2) +
        Date.now().toString(36);

      const userPayload = {
        firebaseUid,
        email,
        name,
        avatar,
        role: finalRole,
        isApproved: true,
        requiresPasswordChange: false,
        password: randomPassword,
        phone: req.body?.phone ? cleanString(req.body.phone) : "",
      };

      try {
        user = await User.create(userPayload);
      } catch (createUserError) {
        console.error("FIREBASE_CREATE_USER_ERROR:", {
          name: createUserError.name,
          code: createUserError.code,
          message: createUserError.message,
          errors: createUserError.errors,
        });

        return res.status(500).json({
          message: "Google account verified, but user creation failed",
          error:
            process.env.NODE_ENV === "production"
              ? undefined
              : createUserError.message,
          errors:
            process.env.NODE_ENV === "production"
              ? undefined
              : createUserError.errors,
        });
      }

      try {
        await createRoleProfile({
          userId: user._id,
          role: user.role,
          profile:
            user.role === "student"
              ? {
                  university: "Egerton University",
                  campus: "Njoro Main Campus",
                  hostel: "",
                  block: "",
                  room: "",
                  landmark: "",
                }
              : user.role === "sponsor"
              ? {
                  organizationName: user.name,
                  contactPerson: user.name,
                  contactPhone: user.phone || "",
                  sponsorshipType: "",
                  monthlyBudget: 0,
                }
              : {},
        });
      } catch (profileError) {
        console.error("FIREBASE_CREATE_PROFILE_ERROR:", {
          name: profileError.name,
          code: profileError.code,
          message: profileError.message,
          errors: profileError.errors,
        });
      }
    }

    if (!user.isApproved) {
      return res.status(403).json({
        message:
          "Account pending approval. Once approved, your login credentials will be mailed to you.",
      });
    }

    const roleProfile = await getRoleProfile(user);
    const safeUser = await User.findById(user._id).select("-password");
    const nav = buildNavigation(safeUser, roleProfile);

    const token = signToken(user._id);

    return res.json({
      token,
      user: publicUser(safeUser),
      profileStatus: nav.profileStatus,
      navigation: nav.navigation,
      requiresPasswordChange: safeUser.requiresPasswordChange,
    });
  } catch (e) {
    console.error("FIREBASE_AUTH_ERROR:", {
      name: e.name,
      code: e.code,
      message: e.message,
      stack: e.stack,
    });

    return res.status(500).json({
      message: "Google authentication failed on backend",
      error: process.env.NODE_ENV === "production" ? undefined : e.message,
      code: process.env.NODE_ENV === "production" ? undefined : e.code,
    });
  }
}

async function me(req, res) {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.sub;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const roleProfile = await getRoleProfile(user);
    const nav = buildNavigation(user, roleProfile);

    return res.json({
      user: publicUser(user),
      profileStatus: nav.profileStatus,
      navigation: nav.navigation,
    });
  } catch (e) {
    console.error("ME_ERROR:", e);
    return res.status(500).json({ message: "Failed to fetch user" });
  }
}

async function completeProfile(req, res) {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.sub;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, phone, profile = {} } = req.body || {};

    const cleanPhone = cleanString(phone);

    if (!isValidKenyanPhone(cleanPhone)) {
      return res.status(400).json({
        message: "Phone number must be 10 digits and start with 07 or 01.",
      });
    }

    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const role = String(user.role || "").toLowerCase();

    if (role !== "student" && role !== "sponsor") {
      return res.status(403).json({
        message:
          "Profile completion is only available for student and sponsor accounts.",
      });
    }

    if (name && cleanString(name).length >= 2) {
      user.name = cleanString(name);
    }

    user.phone = cleanPhone;
    user.requiresPasswordChange = false;

    await user.save();

    let roleProfile = null;

    if (role === "student") {
      const studentPayload = {
        deliveryLocation: profile.deliveryLocation || null,
        university: cleanString(profile.university || "Egerton University"),
        campus: cleanString(profile.campus || "Njoro Main Campus"),
        hostel: cleanString(profile.hostel),
        block: cleanString(profile.block),
        room: cleanString(profile.room),
        landmark: cleanString(profile.landmark),
        instructions: cleanString(profile.instructions),
        diet: cleanString(profile.diet),
        allergies: cleanString(profile.allergies),
      };

      if (!studentPayload.deliveryLocation && !isFilled(studentPayload.hostel)) {
        return res.status(400).json({
          message: "Hostel or delivery location is required.",
        });
      }

      roleProfile = await Student.findOne({ user: user._id });
      if (roleProfile) {
        Object.assign(roleProfile, studentPayload);
        await roleProfile.save();
      } else {
        roleProfile = await Student.create({ user: user._id, ...studentPayload });
      }
    }

    if (role === "sponsor") {
      const sponsorPayload = {
        organizationName: cleanString(profile.organizationName || user.name),
        contactPerson: cleanString(profile.contactPerson || user.name),
        contactPhone: cleanPhone,
        sponsorshipType: cleanString(profile.sponsorshipType),
        monthlyBudget: Number(profile.monthlyBudget || 0),
        approvedStatus: "approved",
      };

      roleProfile = await Sponsor.findOneAndUpdate(
        { user: user._id },
        { $set: sponsorPayload },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    }

    const safeUser = await User.findById(user._id).select("-password");
    const nav = buildNavigation(safeUser, roleProfile);

    return res.json({
      message: "Profile completed successfully.",
      user: publicUser(safeUser),
      profile: roleProfile,
      profileStatus: nav.profileStatus,
      navigation: nav.navigation,
    });
  } catch (e) {
    console.error("COMPLETE_PROFILE_ERROR:", {
      name: e.name,
      code: e.code,
      message: e.message,
      errors: e.errors,
      stack: e.stack,
    });

    return res.status(500).json({
      message: "Failed to complete profile",
      error: process.env.NODE_ENV === "production" ? undefined : e.message,
    });
  }
}

async function changePassword(req, res) {
  try {
    const { userId, oldPassword, newPassword } = req.body;

    if (!userId || !oldPassword || !newPassword) {
      return res.status(400).json({ message: "Missing fields" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters.",
      });
    }

    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const ok = await user.matchPassword(oldPassword);

    if (!ok) {
      return res.status(401).json({ message: "Invalid old password" });
    }

    user.password = newPassword;
    user.requiresPasswordChange = false;

    await user.save();

    return res.json({ message: "Password updated successfully" });
  } catch (e) {
    console.error("CHANGE_PASSWORD_ERROR:", e);
    return res.status(500).json({ message: "Failed to change password" });
  }
}

async function sendSponsorOTP(req, res) {
  const { email } = req.body;
  try {
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail) return res.status(400).json({ message: "Email is required." });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); 

    let user = await User.findOne({ email: cleanEmail });
    if (!user) {
      user = await User.create({
        name: "Sponsor",
        email: cleanEmail,
        role: "sponsor",
        isApproved: true
      });
      
      const Sponsor = require('../models/Sponsor');
      await Sponsor.create({
        user: user._id,
        organizationName: "Sponsor",
        contactPhone: ""
      });
    }

    if (user.role !== 'sponsor') {
      return res.status(403).json({ message: "This email is associated with a non-sponsor account." });
    }

    user.otpCode = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    const { sendMail } = require("../utils/mailer");
    await sendMail({
      to: cleanEmail,
      subject: "NutriPay Sponsor Portal - Verification Code",
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 500px; margin: 0 auto; border: 1px solid #ddd; padding: 25px; text-align: center;">
          <h2 style="color: #f81d1d; border-bottom: 2px solid #f81d1d; padding-bottom: 10px; margin-top: 0;">NutriPay Verification Code</h2>
          <p>Your secure verification code to access your sponsor dashboard is:</p>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 5px; color: #0b1220; margin: 20px 0; background-color: #f8fafc; padding: 15px; border: 1px dashed #ccc;">
            ${otp}
          </div>
          <p style="font-size: 12px; color: #666; margin-bottom: 0;">This code is valid for 10 minutes. Do not share this code with anyone.</p>
        </div>
      `
    });

    res.json({ success: true, message: "Verification code sent successfully!" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to send OTP: " + e.message });
  }
}

async function verifySponsorOTP(req, res) {
  const { email, otp } = req.body;
  try {
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !otp) return res.status(400).json({ message: "Email and OTP are required." });

    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ message: "User not found." });

    if (user.role !== 'sponsor') {
      return res.status(403).json({ message: "Unauthorized account role." });
    }

    if (!user.otpCode || user.otpCode !== otp || !user.otpExpiry || user.otpExpiry < new Date()) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    user.otpCode = null;
    user.otpExpiry = null;
    await user.save();

    const token = signToken(user._id);

    const roleProfile = await getRoleProfile(user);
    const nav = buildNavigation(user, roleProfile);

    res.json({
      token,
      user: publicUser(user),
      profileStatus: nav.profileStatus,
      navigation: nav.navigation
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Verification failed." });
  }
}

module.exports = {
  register,
  login,
  firebaseAuth,
  changePassword,
  me,
  completeProfile,
  sendSponsorOTP,
  verifySponsorOTP
};