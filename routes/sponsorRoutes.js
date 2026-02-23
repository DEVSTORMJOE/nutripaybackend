const express = require('express');
const router = express.Router();
const { getDashboard, fundStudentWallet, getStudentDetails } = require('../controllers/sponsorController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('sponsor'), getDashboard);
router.post('/fund-wallet', protect, role('sponsor'), fundStudentWallet);
router.get('/student/:id', protect, role('sponsor'), getStudentDetails);

module.exports = router;
