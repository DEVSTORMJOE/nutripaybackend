// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');

// const userSchema = new mongoose.Schema({
//   name: {
//     type: String,
//     required: true
//   },
//   email: {
//     type: String,
//     required: true,
//     unique: true
//   },
//   password: {
//     type: String,
//     required: true
//   },
//   role: {
//     type: String,
//     enum: ['student', 'sponsor', 'vendor', 'admin'],
//     required: true
//   },
//   linkedAccounts: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   }]
// }, { timestamps: true });

// // Encrypt password using bcrypt
// userSchema.pre('save', async function (next) {
//   if (!this.isModified('password')) {
//     next();
//   }
//   const salt = await bcrypt.genSalt(10);
//   this.password = await bcrypt.hash(this.password, salt);
// });

// // Match user entered password to hashed password in database
// userSchema.methods.matchPassword = async function (enteredPassword) {
//   return await bcrypt.compare(enteredPassword, this.password);
// };

// const User = mongoose.model('User', userSchema);
// module.exports = User;















// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    unique: true,
    sparse: true,
  },
  avatar: {
    type: String,
    default: "",
  },

  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },

  password: {
    type: String,
    required: function () {
      return !this.firebaseUid; // password required only for non-firebase users
    }
  },

  role: {
    type: String,
    enum: ['student', 'sponsor', 'vendor', 'admin', 'delivery' ],
    required: true
  },

  isApproved: {
    type: Boolean,
    default: true
  },

  requiresPasswordChange: {
    type: Boolean,
    default: false
  },

  linkedAccounts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

// Encrypt password using bcrypt
userSchema.pre('save', async function (next) {
  if (!this.password) return next();
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);
module.exports = User;