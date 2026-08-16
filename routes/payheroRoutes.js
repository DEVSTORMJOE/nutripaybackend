const express = require('express');
const router = express.Router();
const { mpesaCallback } = require('../controllers/mpesaController');

// Webhook hit by PayHero Servers (public)
// Handles:
// POST /api/payhero/callback
// POST /api/payhero/callback/:userId
router.post('/callback/:userId?', mpesaCallback);

module.exports = router;
