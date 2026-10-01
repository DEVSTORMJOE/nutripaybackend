const express = require('express');
const router = express.Router();
const lastDanceController = require('../controllers/lastDanceController');
const { protect } = require('../../../middleware/authMiddleware');
const { role } = require('../../../middleware/roleMiddleware');

/* ==========================================================================
   PUBLIC FRICTIONLESS GUEST ROUTES (NO AUTH REQUIRED)
   ========================================================================== */

// Get system config & active status
router.get('/settings', lastDanceController.getSettings);

// Get approved candidates list with rankings & gap stats
router.get('/candidates', lastDanceController.getCandidates);

// Candidate Registration (100% Free)
router.post('/register', lastDanceController.registerCandidate);

// Buy Event Access Ticket (KES 500 base - M-Pesa STK Push)
router.post('/buy-ticket', lastDanceController.buyTicket);

// Cast Paid Vote (M-Pesa STK Push)
router.post('/cast-vote', lastDanceController.castVote);

// Check M-Pesa Payment Status (polling for tickets & votes)
router.get('/payment-status/:checkoutRequestID', lastDanceController.checkPaymentStatus);

// M-Pesa / PayHero Webhook Callback Handler (Public Webhook)
router.post('/callback', lastDanceController.handlePaymentCallback);

/* ==========================================================================
   ADMIN MANAGEMENT ROUTES (PROTECTED)
   ========================================================================== */

// Get all candidate registrations (pending + approved) and overall statistics
router.get('/admin/candidates', protect, role('admin'), lastDanceController.adminGetCandidates);

// Approve or Reject Candidate (Visibility Gate)
router.patch('/admin/candidates/:candidateId/approve', protect, role('admin'), lastDanceController.adminApproveCandidate);

// Update Candidate details or reassign category
router.put('/admin/candidates/:candidateId', protect, role('admin'), lastDanceController.adminUpdateCandidate);

// Delete Candidate
router.delete('/admin/candidates/:candidateId', protect, role('admin'), lastDanceController.adminDeleteCandidate);

// Update Module Settings (e.g. Turn Module ON/OFF)
router.post('/admin/settings', protect, role('admin'), lastDanceController.updateSettings);

module.exports = router;
