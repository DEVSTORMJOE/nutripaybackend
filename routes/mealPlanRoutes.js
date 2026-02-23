const express = require('express');
const router = express.Router();
const { getPublicMealPlans } = require('../controllers/publicController');

router.get('/', getPublicMealPlans);

module.exports = router;
