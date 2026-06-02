const express = require('express');
const router = express.Router();
const { getDashboard, fundStudentWallet, getSponsoredStudents, getPendingRequests, fundRequest, getRequestDetails, quickPay, quickPayMpesa, checkSponsorMpesaStatus } = require('../controllers/sponsorController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('sponsor'), getDashboard);
router.post('/fund-wallet', protect, role('sponsor'), fundStudentWallet);
router.get('/students', protect, role('sponsor'), getSponsoredStudents);
router.get('/pending-requests', protect, role('sponsor'), getPendingRequests);
router.post('/fund-request', protect, role('sponsor'), fundRequest);

// Secure public sponsor pay endpoints
router.get('/request/:token', getRequestDetails);
router.post('/quick-pay', quickPay);
router.post('/quick-pay/mpesa', quickPayMpesa);
router.get('/mpesa-status/:checkoutRequestID', checkSponsorMpesaStatus);

module.exports = router;
