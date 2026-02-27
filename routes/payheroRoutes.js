const express = require('express');
const router = express.Router();
const { payheroDeposit, payheroCallback, checkPayheroStatus } = require('../controllers/payheroController');
const { protect } = require('../middleware/authMiddleware');

// Route initiated by user on frontend
router.post('/deposit', protect, payheroDeposit);

// User polls this to see if the webhook gave a success code
router.get('/status/:reference', protect, checkPayheroStatus);

// Webhook hit by PayHero Servers (must be public, so no `protect` wrapper here!)
// We pass userId dynamically in URL to link the callback to the right user wallet
router.post('/callback/:userId', payheroCallback);

module.exports = router;
