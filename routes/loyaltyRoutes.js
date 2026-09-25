const express = require('express');
const router = express.Router();
const { getStatus, convertPoints } = require('../controllers/loyaltyController');
const { protect } = require('../middleware/authMiddleware');
const { generalLimiter, transactionLimiter } = require('../middleware/rateLimiters');

router.get('/status', protect, generalLimiter, getStatus);
router.post('/convert', protect, transactionLimiter, convertPoints);

module.exports = router;
