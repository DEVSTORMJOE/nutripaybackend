const mongoose = require('mongoose');

const nDashProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  priceKES: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  imageUrl: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const NDashProduct = mongoose.models.NDashProduct || mongoose.model('NDashProduct', nDashProductSchema);
module.exports = NDashProduct;
