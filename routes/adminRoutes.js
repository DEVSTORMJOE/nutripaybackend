const express = require('express');
const router = express.Router();
const { getDashboard, approveMealPlan, getUsers, getPendingApprovals, approveVendor } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.get('/dashboard', protect, role('admin'), getDashboard);
router.get('/users', protect, role('admin'), getUsers);
router.get('/pending', protect, role('admin'), getPendingApprovals);
router.post('/approve/mealplan', protect, role('admin'), approveMealPlan);
router.post('/approve/vendor', protect, role('admin'), approveVendor);

module.exports = router;
