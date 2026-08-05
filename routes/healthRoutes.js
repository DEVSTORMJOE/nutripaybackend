const express = require('express');
const router = express.Router();
const { getProductionHealth } = require('../controllers/healthController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/production', protect, role('admin'), getProductionHealth);

module.exports = router;
