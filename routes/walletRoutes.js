const express = require('express');
const router = express.Router();
const { getWalletBalance, getTransactions } = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');

router.get('/balance', protect, getWalletBalance);
router.get('/transactions', protect, getTransactions);

module.exports = router;
