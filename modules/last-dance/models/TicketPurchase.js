const mongoose = require('mongoose');

const TicketPurchaseSchema = new mongoose.Schema({
    checkoutRequestID: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    buyerName: {
        type: String,
        required: true,
        trim: true
    },
    buyerEmail: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    buyerPhone: {
        type: String,
        required: true,
        trim: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    pricePerTicketKES: {
        type: Number,
        required: true,
        default: 500
    },
    totalAmountKES: {
        type: Number,
        required: true
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
    },
    tickets: [{
        ticketCode: {
            type: String,
            required: true
        },
        qrCodeUrl: {
            type: String
        },
        scanned: {
            type: Boolean,
            default: false
        },
        scannedAt: {
            type: Date
        }
    }],
    emailSent: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('LastDanceTicketPurchase', TicketPurchaseSchema);
