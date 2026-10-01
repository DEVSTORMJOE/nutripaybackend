const mongoose = require('mongoose');

const LastDanceSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'global',
        unique: true
    },
    enabled: {
        type: Boolean,
        default: true
    },
    eventDate: {
        type: String,
        default: '2026-10-26'
    },
    eventTitle: {
        type: String,
        default: 'Last Dance'
    },
    tagline: {
        type: String,
        default: 'One Last Night. One Last Dance.'
    },
    ticketPriceKES: {
        type: Number,
        default: 500
    },
    musicUrl: {
        type: String,
        default: ''
    },
    categories: {
        type: [String],
        default: [
            'Mr & Miss Last Dance',
            'Most Likely to Succeed',
            'Best Dressed / Most Stylish',
            'Life of the Party',
            'Power Couple',
            'Campus Icon',
            'Comeback King/Queen',
            'Squad of the Year',
            'Most Missed'
        ]
    },
    votePackages: [{
        label: String,
        votes: Number,
        priceKES: Number,
        discountText: String,
        isPopular: Boolean
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('LastDanceSettings', LastDanceSettingsSchema);
