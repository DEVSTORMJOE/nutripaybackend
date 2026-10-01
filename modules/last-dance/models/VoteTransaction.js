const mongoose = require('mongoose');

const VoteTransactionSchema = new mongoose.Schema({
    checkoutRequestID: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LastDanceCandidate',
        required: true,
        index: true
    },
    voterPhone: {
        type: String,
        required: true,
        trim: true
    },
    votesCount: {
        type: Number,
        required: true,
        min: 1
    },
    amountKES: {
        type: Number,
        required: true
    },
    packageLabel: {
        type: String,
        default: 'Single Vote'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        default: 'pending',
        index: true
    },
    mpesaReceiptNumber: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('LastDanceVoteTransaction', VoteTransactionSchema);
