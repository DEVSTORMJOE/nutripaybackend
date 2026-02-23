const express = require('express');
const router = express.Router();
const { mpesaDeposit, mpesaCallback, checkMpesaStatus } = require('../controllers/mpesaController');
const { protect } = require('../middleware/authMiddleware');

// Route initiated by user on frontend
router.post('/deposit', protect, mpesaDeposit);

// User polls this to see if the webhook gave a success code
router.get('/status/:checkoutRequestID', protect, checkMpesaStatus);

// Webhook hit by Safaricom Servers (must be public, so no `protect` wrapper here!)
// We pass userId dynamically in URL to link the callback to the right user wallet
router.post('/callback/:userId', mpesaCallback);

module.exports = router;
