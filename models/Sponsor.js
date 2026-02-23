const mongoose = require('mongoose');

const sponsorSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stellarPublicKey: {
    type: String,
    // Optional if they just pay via external wallet, but good to have if we generate one
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }]
}, { timestamps: true });

const Sponsor = mongoose.model('Sponsor', sponsorSchema);
module.exports = Sponsor;
