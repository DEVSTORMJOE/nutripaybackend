const mongoose = require('mongoose');

const CandidateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Candidate name is required'],
        trim: true
    },
    photoUrl: {
        type: String,
        required: [true, 'Candidate photo URL is required']
    },
    oneLiner: {
        type: String,
        required: [true, 'One-liner slogan is required'],
        trim: true,
        maxlength: 120
    },
    pitch: {
        type: String,
        required: [true, 'Pitch description is required'],
        trim: true,
        maxlength: 1000
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: [
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
    isApproved: {
        type: Boolean,
        default: false,
        index: true
    },
    voteCount: {
        type: Number,
        default: 0,
        index: true
    },
    registrationDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('LastDanceCandidate', CandidateSchema);
