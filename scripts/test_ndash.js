const mongoose = require('mongoose');
require('dotenv').config();

const ndashService = require('../services/ndashService');
const NDashOrder = require('../models/NDashOrder');
const NDashProduct = require('../models/NDashProduct');
const NDashAuditLog = require('../models/NDashAuditLog');
const User = require('../models/User');
const DeliveryLocation = require('../models/DeliveryLocation');
const DeliveryPersonnel = require('../models/DeliveryPersonnel');
const Transaction = require('../models/Transaction');

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay').then(async () => {
  console.log('--- STARTING N-DASH INTEGRATION TEST SUITE ---');

  // Test 1: Fee calculations logic
  console.log('\n[Test 1] Verifying N-Dash tiered fee calculations...');
  const fee1 = ndashService.calculateNDashFee(200); // <= 500 KES (10% fee)
  const fee2 = ndashService.calculateNDashFee(600); // > 500 KES (50 KES flat fee)

  console.log(`  Errand price 200 KES -> Fee calculated: ${fee1} KES (Expected: 20 KES)`);
  console.log(`  Errand price 600 KES -> Fee calculated: ${fee2} KES (Expected: 50 KES)`);

  if (fee1 !== 20 || fee2 !== 50) {
    console.error('  ❌ Fee calculations test failed!');
    process.exit(1);
  }
  console.log('  ✅ Fee calculations test passed.');

  // Find or create test entities
  console.log('\n[Test 2] Setting up dummy/test entities...');
  let studentUser = await User.findOne({ role: 'student' });
  if (!studentUser) {
    studentUser = await User.create({
      name: 'Test Student',
      email: 'teststudent_ndash@nutripay.local',
      password: 'password123',
      role: 'student',
      phone: '254700000001'
    });
  } else if (!studentUser.phone) {
    studentUser.phone = '254700000001';
    await studentUser.save();
  }

  let driverUser = await User.findOne({ role: 'delivery' });
  if (!driverUser) {
    driverUser = await User.create({
      name: 'Test Driver',
      email: 'testdriver_ndash@nutripay.local',
      password: 'password123',
      role: 'delivery',
      phone: '254700000002'
    });
  } else if (!driverUser.phone) {
    driverUser.phone = '254700000002';
    await driverUser.save();
  }

  let location = await DeliveryLocation.findOne({});
  if (!location) {
    location = await DeliveryLocation.create({
      hostelResidence: 'Test Errand Residence Hall',
      campus: 'Main Campus',
      university: 'State University',
      isActive: true
    });
  }

  // Ensure driver personnel profile exists and is assigned
  let driverProfile = await DeliveryPersonnel.findOne({ user: driverUser._id });
  if (!driverProfile) {
    driverProfile = await DeliveryPersonnel.create({
      user: driverUser._id,
      approvedStatus: 'approved',
      assignedLocations: [location._id],
      assignmentType: 'both',
      status: 'Available'
    });
  } else {
    driverProfile.assignedLocations = [location._id];
    driverProfile.assignmentType = 'both';
    await driverProfile.save();
  }

  console.log(`  Student resolved: ${studentUser.name} (${studentUser._id})`);
  console.log(`  Driver resolved: ${driverUser.name} (${driverUser._id})`);
  console.log(`  Location resolved: ${location.hostelResidence} (${location._id})`);
  console.log('  ✅ Setup complete.');

  // Test 3: Create suggested products
  console.log('\n[Test 3] Testing catalog items management...');
  await NDashProduct.deleteMany({ name: 'Test Catalog Milk' });
  const product = await NDashProduct.create({
    name: 'Test Catalog Milk',
    priceKES: 100,
    imageUrl: 'https://domain.com/milk.jpg',
    isActive: true
  });
  console.log(`  Suggested Catalog product created: ${product.name} @ ${product.priceKES} KES`);
  if (!product) {
    console.error('  ❌ Catalog product creation failed.');
    process.exit(1);
  }
  console.log('  ✅ Catalog catalog test passed.');

  // Test 4: E2E Order Placement, assignment, and processing
  console.log('\n[Test 4] Simulating order flow...');
  
  // Cleanup old test orders
  await NDashOrder.deleteMany({ student: studentUser._id });

  const items = [
    { name: 'Milk Carton', quantity: 2, estimatedPrice: 100, notes: 'Fresh packet' },
    { name: 'Bread', quantity: 1, estimatedPrice: 60, notes: 'Whole wheat' }
  ];

  const shoppingCost = 260; // (100 * 2) + 60
  const platformFee = ndashService.calculateNDashFee(shoppingCost); // 26 KES
  const grandTotal = shoppingCost + platformFee; // 286 KES

  // Autoassign
  const assignedAgent = await ndashService.assignDriverForLocation(location._id);
  console.log(`  Auto-assign runner query returned: ${assignedAgent}`);

  const orderId = `ND-TEST-${Math.random().toString(36).substring(7).toUpperCase()}`;
  const order = await NDashOrder.create({
    orderId,
    student: studentUser._id,
    items,
    shoppingCost,
    platformFee,
    grandTotal,
    deliveryLocation: location._id,
    room: 'Block B 104',
    deliveryAgent: assignedAgent || driverUser._id,
    status: 'pending_payment',
    checkoutRequestID: `ws_ND_Mock_test_${Date.now()}`
  });

  console.log(`  Order created: ${order.orderId} (Grand Total: ${order.grandTotal} KES)`);
  
  // Clean up duplicate transactions from previous test runs
  await Transaction.deleteMany({ transactionId: 'MPESA_REC_TEST_99' });

  // Simulate payment callback trigger success
  const ndashPaymentService = require('../services/ndashPaymentService');
  await ndashPaymentService.processPaymentSuccess(
    order.checkoutRequestID,
    'MPESA_REC_TEST_99',
    order.grandTotal,
    studentUser.phone
  );

  const paidOrder = await NDashOrder.findById(order._id);
  console.log(`  M-Pesa payment processed callback. Order status transitioned to: ${paidOrder.status}`);
  if (paidOrder.status !== 'pending') {
    console.error('  ❌ Payment transition test failed!');
    process.exit(1);
  }

  // Simulate Driver claims/accepts the order
  paidOrder.deliveryAgent = driverUser._id;
  paidOrder.status = 'accepted';
  await paidOrder.save();
  console.log(`  Driver claimed order. Order status transitioned to: ${paidOrder.status}`);

  // Driver starts shopping
  paidOrder.status = 'shopping';
  await paidOrder.save();
  console.log(`  Driver shopping. Order status transitioned to: ${paidOrder.status}`);

  // Driver generates handover code
  const orderWithCode = await ndashService.generateVerificationCode(paidOrder);
  console.log(`  Handover code generated: ${orderWithCode.deliveryVerificationCode} (Expiry: ${orderWithCode.deliveryVerificationExpiry})`);
  if (!orderWithCode.deliveryVerificationCode.startsWith('NP-')) {
    console.error('  ❌ Handover code format invalid!');
    process.exit(1);
  }

  // Driver transitions to out_for_delivery
  orderWithCode.status = 'out_for_delivery';
  await orderWithCode.save();
  console.log(`  Driver out for delivery. Order status: ${orderWithCode.status}`);

  // Driver verifies student handover code to complete the order and trigger driver payout
  console.log('  Driver verifying code from student...');
  const completedOrder = await ndashService.verifyDeliveryCode(
    orderWithCode._id,
    orderWithCode.deliveryVerificationCode,
    driverUser._id
  );

  console.log(`  Handovers verified! Order final status: ${completedOrder.status}`);
  if (completedOrder.status !== 'delivered') {
    console.error('  ❌ Order handover confirmation failed!');
    process.exit(1);
  }

  // Verify that payout transactions were logged
  const txPayment = await Transaction.findOne({ transactionId: 'MPESA_REC_TEST_99', transactionCategory: 'ndash_payment' });
  const txPayout = await Transaction.findOne({ toUser: driverUser._id, transactionCategory: 'ndash_payout' });
  const auditLogs = await NDashAuditLog.find({ ndashOrder: order._id });

  console.log(`  Audit Logs generated count: ${auditLogs.length}`);
  console.log(`  ndash_payment transaction logged: ${txPayment ? '✅ Yes' : '❌ No'}`);
  console.log(`  ndash_payout transaction logged: ${txPayout ? '✅ Yes' : '❌ No'}`);

  if (!txPayment || !txPayout || auditLogs.length === 0) {
    console.error('  ❌ Ledger log testing failed.');
    process.exit(1);
  }

  console.log('\n✅ ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY.');
  process.exit(0);
}).catch(err => {
  console.error('Test script database initialization failed:', err);
  process.exit(1);
});
