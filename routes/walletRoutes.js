const express = require('express');
const router = express.Router();
const { getWalletBalance, getTransactions, mockFund } = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');
const { generalLimiter, transactionLimiter } = require('../middleware/rateLimiters');

router.get('/', protect, generalLimiter, getWalletBalance);
router.get('/balance', protect, generalLimiter, getWalletBalance);
router.get('/transactions', protect, generalLimiter, getTransactions);
router.post('/mock-fund', protect, transactionLimiter, mockFund);

module.exports = router;
