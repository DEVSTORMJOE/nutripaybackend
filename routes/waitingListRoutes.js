const express = require('express');
const router = express.Router();
const { joinWaitingList, getWaitingList, getWaitlistCount } = require('../controllers/waitingListController');
const { protect, admin } = require('../middleware/authMiddleware');

router.post('/', joinWaitingList);
router.get('/', getWaitingList); 
router.get('/count', getWaitlistCount);

module.exports = router;
