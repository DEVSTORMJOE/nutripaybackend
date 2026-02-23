const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stellarPublicKey: {
    type: String,
    required: true
  },
  // We store the encrypted secret only if absolutely necessary, but ideally NOT.
  // For Hackathon MVP, we might need to store it or ask user to provide it.
  // The requirements say "No private key storage" for security, but user needs to sign?
  // Wait, the Student Wallet has Weight 1, Platform has Weight 2.
  // Platform signs for payments. Student initiates?
  // For this MVP, let's assume Platform manages the wallet entirely for the student via API.
  // OR we store the secret encrypted.
  // Let's stick to Public Key here.
  sponsorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sponsor'
  },
  subscriptionActive: {
    type: Boolean,
    default: false
  },
  mealPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MealPlan'
  },
  modificationCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

const Student = mongoose.model('Student', studentSchema);
module.exports = Student;
