const express = require('express');
const router = express.Router();
const { getDashboard, fundStudentWallet, getSponsoredStudents } = require('../controllers/sponsorController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('sponsor'), getDashboard);
router.post('/fund-wallet', protect, role('sponsor'), fundStudentWallet);
router.get('/students', protect, role('sponsor'), getSponsoredStudents);
const { getPendingRequests, fundRequest } = require('../controllers/sponsorController');
router.get('/pending-requests', protect, role('sponsor'), getPendingRequests);
router.post('/fund-request', protect, role('sponsor'), fundRequest);

module.exports = router;
