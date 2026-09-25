const loyaltyService = require("../services/loyaltyService");

/**
 * @desc    Get user loyalty points status & activity history
 * @route   GET /api/loyalty/status
 * @access  Private
 */
const getStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const status = await loyaltyService.getLoyaltyStatus(userId);
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Get Loyalty Status Error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch loyalty status" });
  }
};

/**
 * @desc    Manually convert accumulated loyalty points to active wallet KES & Stellar NT
 * @route   POST /api/loyalty/convert
 * @access  Private
 */
const convertPoints = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const result = await loyaltyService.processThresholdConversion(userId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      data: result,
      message: `Successfully converted ${result.pointsConverted} points to KES ${result.kesAdded} wallet balance!`,
    });
  } catch (error) {
    console.error("Convert Loyalty Points Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to convert loyalty points" });
  }
};

module.exports = {
  getStatus,
  convertPoints,
};
