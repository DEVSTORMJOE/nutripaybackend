const express = require('express');
const router = express.Router();
const { getActiveSponsors, getAllSponsors, createSponsor, updateSponsor, deleteSponsor } = require('../controllers/publicSponsorController');

// In production, these admin routes should utilize the protect and role middlewares.
// For now, they correspond to the endpoints hit by the frontend.
router.get('/', getActiveSponsors);
router.get('/admin/all', getAllSponsors);
router.post('/admin', createSponsor);
router.put('/admin/:id', updateSponsor);
router.delete('/admin/:id', deleteSponsor);

module.exports = router;
