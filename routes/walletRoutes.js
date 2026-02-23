const express = require('express');
const router = express.Router();
const { getWalletBalance, getTransactions, mockFund } = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');

router.get('/balance', protect, getWalletBalance);
router.get('/transactions', protect, getTransactions);
router.post('/mock-fund', protect, mockFund);

module.exports = router;
