const express = require('express');
const router = express.Router();
const { mpesaDeposit, mpesaCallback, checkMpesaStatus, mpesaWithdraw, getMyWithdrawalRequests, mpesaB2CCallback } = require('../controllers/mpesaController');
const { protect, checkActiveWallet } = require('../middleware/authMiddleware');

// Route initiated by user on frontend
router.post('/deposit', protect, mpesaDeposit);
router.post('/withdraw', protect, checkActiveWallet, mpesaWithdraw);
router.get('/my-withdrawals', protect, getMyWithdrawalRequests);

// User polls this to see if the webhook gave a success code
router.get('/status/:checkoutRequestID', protect, checkMpesaStatus);

// Webhook hit by Safaricom or PayHero Servers (must be public)
router.post('/callback/:userId?', mpesaCallback);
router.post('/payhero/callback/:userId?', mpesaCallback);

// B2C callback webhook for withdrawals
router.post('/b2c-callback', mpesaB2CCallback);

module.exports = router;
