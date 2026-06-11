const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const NDashOrder = require('../models/NDashOrder');
const NDashAuditLog = require('../models/NDashAuditLog');

/**
 * Calculate the N-Dash platform fee based on order value
 * @param {Number} shoppingCost 
 * @returns {Number}
 */
function calculateNDashFee(shoppingCost) {
  const cost = Number(shoppingCost || 0);
  if (cost <= 500) {
    return Number((cost * 0.1).toFixed(2));
  } else {
    return 50;
  }
}

/**
 * Automatically route/assign a driver for an N-Dash order
 * @param {String} deliveryLocationId 
 * @returns {Promise<Object|null>} Driver User document
 */
async function assignDriverForLocation(deliveryLocationId) {
  try {
    const activeStatuses = ['pending', 'accepted', 'shopping', 'out_for_delivery'];
    let candidateDrivers = [];
    
    // 1. Try to find drivers assigned to the specific location first
    if (deliveryLocationId) {
      candidateDrivers = await DeliveryPersonnel.find({
        approvedStatus: 'approved',
        assignmentType: { $in: ['ndash', 'both'] },
        assignedLocations: deliveryLocationId
      }).populate('user');
    }
    
    // 2. Fallback: If no drivers for the specific location OR it is a custom location
    if (candidateDrivers.length === 0) {
      // First try strictly ndash-only staff
      candidateDrivers = await DeliveryPersonnel.find({
        approvedStatus: 'approved',
        assignmentType: 'ndash'
      }).populate('user');
      
      // If none, fallback to any ndash or both
      if (candidateDrivers.length === 0) {
        candidateDrivers = await DeliveryPersonnel.find({
          approvedStatus: 'approved',
          assignmentType: { $in: ['ndash', 'both'] }
        }).populate('user');
      }
    }
    
    if (candidateDrivers.length === 0) {
      return null;
    }
    
    // 3. Work distribution: count active N-Dash orders + active meal deliveries and choose the least busy driver
    const Delivery = require('../models/Delivery');
    const driverJobs = await Promise.all(
      candidateDrivers.map(async (driver) => {
        if (!driver.user) return { driver, count: Infinity };
        const ndashCount = await NDashOrder.countDocuments({
          deliveryAgent: driver.user._id,
          status: { $in: activeStatuses }
        });
        const mealCount = await Delivery.countDocuments({
          deliveryAgent: driver.user._id,
          status: { $in: ['assigned', 'picked_up'] }
        });
        return { driver, count: ndashCount + mealCount };
      })
    );
    
    const validJobs = driverJobs.filter(j => j.driver.user);
    if (validJobs.length === 0) {
      return null;
    }
    
    // Sort by active count ascending
    validJobs.sort((a, b) => a.count - b.count);
    
    return validJobs[0].driver.user;
  } catch (err) {
    console.error('[ndashService] assignDriverForLocation error:', err.message);
    return null;
  }
}

/**
 * Generate a unique verification code that expires at midnight
 * @param {Object} order Mongoose order document
 * @returns {Promise<Object>}
 */
async function generateVerificationCode(order) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const code = `NP-${part1}-${part2}`;
  
  const expiry = new Date();
  expiry.setHours(23, 59, 59, 999);
  
  order.deliveryVerificationCode = code;
  order.deliveryVerificationExpiry = expiry;
  await order.save();
  
  await NDashAuditLog.create({
    action: 'code_generated',
    ndashOrder: order._id,
    details: { code, expiry }
  });
  
  return order;
}

/**
 * Verify order completion using the verification code
 * @param {String} orderId 
 * @param {String} code 
 * @param {String} driverUserId 
 * @returns {Promise<Object>} Verification results
 */
async function verifyDeliveryCode(orderId, code, driverUserId) {
  const order = await NDashOrder.findById(orderId).populate('student');
  if (!order) {
    throw new Error('Order not found');
  }
  
  if (order.status === 'delivered') {
    throw new Error('Order already delivered');
  }
  
  if (!order.deliveryVerificationCode) {
    throw new Error('Verification code has not been generated for this order');
  }
  
  const providedCode = String(code || '').trim().toUpperCase();
  const actualCode = String(order.deliveryVerificationCode).trim().toUpperCase();
  
  if (providedCode !== actualCode) {
    throw new Error('Invalid delivery verification code. Access Denied.');
  }
  
  if (order.deliveryVerificationExpiry && new Date() > new Date(order.deliveryVerificationExpiry)) {
    throw new Error('Delivery verification code has expired.');
  }
  
  // Mark as delivered
  order.status = 'delivered';
  order.completedAt = new Date();
  order.deliveryAgent = driverUserId;
  await order.save();
  
  // Log audit
  await NDashAuditLog.create({
    action: 'delivery_completed',
    user: driverUserId,
    ndashOrder: order._id,
    details: { verifiedCode: code }
  });
  
  return order;
}

module.exports = {
  calculateNDashFee,
  assignDriverForLocation,
  generateVerificationCode,
  verifyDeliveryCode
};
