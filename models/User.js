
// // // models/User.js
// // const mongoose = require('mongoose');
// // const bcrypt = require('bcryptjs');

// // const userSchema = new mongoose.Schema({
// //   firebaseUid: {
// //     type: String,
// //     unique: true,
// //     sparse: true,
// //   },
// //   avatar: {
// //     type: String,
// //     default: "",
// //   },

// //   name: { type: String, required: true },
// //   email: { type: String, required: true, unique: true },
// //   phone: { type: String },

// //   password: {
// //     type: String,
// //     required: function () {
// //       return !this.firebaseUid; // password required only for non-firebase users
// //     }
// //   },

// //   role: {
// //     type: String,
// //     enum: ['student', 'sponsor', 'vendor', 'admin', 'delivery' ],
// //     required: true
// //   },

// //   isApproved: {
// //     type: Boolean,
// //     default: true
// //   },

// //   requiresPasswordChange: {
// //     type: Boolean,
// //     default: false
// //   },

// //   linkedAccounts: [{
// //     type: mongoose.Schema.Types.ObjectId,
// //     ref: 'User'
// //   }]
// // }, { timestamps: true });

// // // Encrypt password using bcrypt
// // userSchema.pre('save', async function (next) {
// //   if (!this.password) return next();
// //   if (!this.isModified('password')) return next();

// //   const salt = await bcrypt.genSalt(10);
// //   this.password = await bcrypt.hash(this.password, salt);
// //   next();
// // });

// // // Match user entered password to hashed password in database
// // userSchema.methods.matchPassword = async function (enteredPassword) {
// //   if (!this.password) return false;
// //   return await bcrypt.compare(enteredPassword, this.password);
// // };

// // const User = mongoose.model('User', userSchema);
// // module.exports = User;







// // models/User.js
// const mongoose = require("mongoose");
// const bcrypt = require("bcryptjs");

// const userSchema = new mongoose.Schema(
//   {
//     firebaseUid: {
//       type: String,
//       unique: true,
//       sparse: true,
//       index: true,
//     },

//     avatar: {
//       type: String,
//       default: "",
//     },

//     name: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     email: {
//       type: String,
//       required: true,
//       unique: true,
//       lowercase: true,
//       trim: true,
//       index: true,
//     },

//     phone: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     password: {
//       type: String,
//       select: false,
//       required: function () {
//         return !this.firebaseUid;
//       },
//     },

//     role: {
//       type: String,
//       enum: ["student", "sponsor", "vendor", "admin", "delivery"],
//       required: true,
//       default: "student",
//     },

//     isApproved: {
//       type: Boolean,
//       default: true,
//     },

//     requiresPasswordChange: {
//       type: Boolean,
//       default: false,
//     },

//     linkedAccounts: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "User",
//       },
//     ],
//   },
//   { timestamps: true }
// );

// userSchema.pre("save", async function (next) {
//   if (!this.password) return next();
//   if (!this.isModified("password")) return next();

//   const salt = await bcrypt.genSalt(10);
//   this.password = await bcrypt.hash(this.password, salt);

//   next();
// });

// userSchema.methods.matchPassword = async function (enteredPassword) {
//   if (!this.password) return false;
//   return bcrypt.compare(enteredPassword, this.password);
// };

// const User = mongoose.model("User", userSchema);

// module.exports = User;






// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    avatar: {
      type: String,
      default: "",
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    password: {
      type: String,
      select: false,
      required: function () {
        if (this.firebaseUid) return false;

        const role = String(this.role || "").toLowerCase();

        if (role === "vendor" || role === "delivery") {
          return false;
        }

        return true;
      },
    },

    role: {
      type: String,
      enum: ["student", "sponsor", "vendor", "admin", "delivery"],
      required: true,
      default: "student",
    },

    isApproved: {
      type: Boolean,
      default: true,
    },

    requiresPasswordChange: {
      type: Boolean,
      default: false,
    },

    linkedAccounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.password) return next();
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;