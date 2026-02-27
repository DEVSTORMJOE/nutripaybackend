const mongoose = require('mongoose');

const payheroDepositSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    reference: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    receiptNumber: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('PayheroDeposit', payheroDepositSchema);
