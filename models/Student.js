// // const mongoose = require('mongoose');

// // const studentSchema = new mongoose.Schema({
// //   user: {
// //     type: mongoose.Schema.Types.ObjectId,
// //     ref: 'User',
// //     required: true
// //   },
// //   stellarPublicKey: {
// //     type: String,
// //     required: true
// //   },
// //   // We store the encrypted secret only if absolutely necessary, but ideally NOT.
// //   // For Hackathon MVP, we might need to store it or ask user to provide it.
// //   // The requirements say "No private key storage" for security, but user needs to sign?
// //   // Wait, the Student Wallet has Weight 1, Platform has Weight 2.
// //   // Platform signs for payments. Student initiates?
// //   // For this MVP, let's assume Platform manages the wallet entirely for the student via API.
// //   // OR we store the secret encrypted.
// //   // Let's stick to Public Key here.
// //   sponsorId: {
// //     type: mongoose.Schema.Types.ObjectId,
// //     ref: 'Sponsor'
// //   },
// //   subscriptionActive: {
// //     type: Boolean,
// //     default: false
// //   },
// //   mealId: {
// //     type: mongoose.Schema.Types.ObjectId,
// //     ref: 'Meal'
// //   },
// //   modificationCount: {
// //     type: Number,
// //     default: 0
// //   }
// // }, { timestamps: true });

// // const Student = mongoose.model('Student', studentSchema);
// // module.exports = Student;




// // models/Student.js
// const mongoose = require("mongoose");

// const studentSchema = new mongoose.Schema(
//   {
//     user: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//       unique: true,
//       index: true,
//     },

//     stellarPublicKey: {
//       type: String,
//       default: "",
//     },

//     university: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     campus: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     hostel: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     block: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     room: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     landmark: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     instructions: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     diet: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     allergies: {
//       type: String,
//       trim: true,
//       default: "",
//     },

//     sponsorId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Sponsor",
//       default: null,
//     },

//     subscriptionActive: {
//       type: Boolean,
//       default: false,
//     },

//     mealId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Meal",
//       default: null,
//     },

//     modificationCount: {
//       type: Number,
//       default: 0,
//     },
//   },
//   { timestamps: true }
// );

// const Student = mongoose.model("Student", studentSchema);

// module.exports = Student;




// models/Student.js
const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    studentId: {
      type: String,
      unique: true,
      sparse: true,
    },

    deliveryLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryLocation",
      default: null,
    },

    stellarPublicKey: {
      type: String,
      default: "",
    },

    university: {
      type: String,
      trim: true,
      default: "Egerton University",
    },

    campus: {
      type: String,
      trim: true,
      default: "Njoro Main Campus",
    },

    hostel: {
      type: String,
      trim: true,
      default: "",
    },

    block: {
      type: String,
      trim: true,
      default: "",
    },

    floor: {
      type: String,
      trim: true,
      default: "",
    },

    room: {
      type: String,
      trim: true,
      default: "",
    },

    landmark: {
      type: String,
      trim: true,
      default: "",
    },

    instructions: {
      type: String,
      trim: true,
      default: "",
    },

    diet: {
      type: String,
      trim: true,
      default: "",
    },

    allergies: {
      type: String,
      trim: true,
      default: "",
    },

    sponsorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsor",
      default: null,
    },

    subscriptionActive: {
      type: Boolean,
      default: false,
    },

    mealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
      default: null,
    },

    modificationCount: {
      type: Number,
      default: 0,
    },
    cancelledBreakfastCount: {
      type: Number,
      default: 0,
    },
    cancelledLunchCount: {
      type: Number,
      default: 0,
    },
    cancelledSupperCount: {
      type: Number,
      default: 0,
    },
    cancellationResetMonth: {
      type: Number,
      default: () => new Date().getMonth(),
    },
    shufflesCount: {
      type: Number,
      default: 0,
    },
    lastShuffleDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

studentSchema.pre("save", function (next) {
  if (!this.studentId) {
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    this.studentId = `ST-${year}-${randomNum}`;
  }
  next();
});

const Student = mongoose.models.Student || mongoose.model("Student", studentSchema);

module.exports = Student;