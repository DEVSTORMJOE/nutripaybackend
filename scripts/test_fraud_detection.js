const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Vendor = require('../models/Vendor');
const RefundRequest = require('../models/RefundRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Delivery = require('../models/Delivery');
const AuditCase = require('../models/AuditCase');
require('../models/DeliveryLocation');

const fraudDetectionService = require('../services/fraudDetectionService');

async function runFraudTests() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log("Connected to MongoDB for Fraud Detection Compliance Tests.");

    // Setup entities
    let studentUser = await User.findOne({ role: 'student' });
    if (!studentUser) {
      studentUser = await User.create({
        name: 'Test Fraud Student',
        email: 'student_frd@nutripay.local',
        password: 'Password123',
        role: 'student',
        phone: '254744444444'
      });
    }

    let vendorUser = await User.findOne({ role: 'vendor' });
    if (!vendorUser) {
      vendorUser = await User.create({
        name: 'Test Fraud Vendor Owner',
        email: 'vendor_frd@nutripay.local',
        password: 'Password123',
        role: 'vendor'
      });
    }

    let vendorRecord = await Vendor.findOne({ user: vendorUser._id });
    if (!vendorRecord) {
      vendorRecord = await Vendor.create({
        user: vendorUser._id,
        businessName: "Test Fraud Kitchen",
        stellarPublicKey: "G12345",
        approvedStatus: 'approved'
      });
    }

    console.log("\n=======================================================");
    console.log("🛡️  RUNNING PENETRATION TEST: FRAUD COMPLIANCE ENGINE");
    console.log("=======================================================");

    // ----------------------------------------------------
    // CASE 1: Refund Abuse Velocity Trigger
    // ----------------------------------------------------
    console.log("\n[Case 1] Seeding 3 refund requests in 24 hours to trigger alert...");
    await RefundRequest.deleteMany({ student: studentUser._id });
    
    await RefundRequest.create([
      { student: studentUser._id, amountKES: 100, status: 'pending_admin_approval', source: 'available_balance_refund', fundingType: 'self' },
      { student: studentUser._id, amountKES: 150, status: 'pending_admin_approval', source: 'available_balance_refund', fundingType: 'self' },
      { student: studentUser._id, amountKES: 200, status: 'pending_admin_approval', source: 'available_balance_refund', fundingType: 'self' }
    ]);

    // ----------------------------------------------------
    // CASE 2: Rapid Delivery Handover Trigger
    // ----------------------------------------------------
    console.log("\n[Case 2] Seeding a rapid delivery complete in under 2 minutes...");
    await Delivery.deleteMany({ vendor: vendorRecord._id });

    const createdTime = new Date();
    const deliveredTime = new Date(createdTime.getTime() + 45 * 1000); // 45 seconds later

    const rapidDelivery = await Delivery.create({
      student: studentUser._id,
      vendor: vendorRecord._id,
      location: "Hostel Room 101",
      totalCost: 100,
      status: "delivered",
      createdAt: createdTime,
      deliveredAt: deliveredTime,
      scheduledDate: new Date()
    });

    // ----------------------------------------------------
    // CASE 3: Vendor Cancellation Rate Trigger
    // ----------------------------------------------------
    console.log("\n[Case 3] Seeding abnormal vendor cancellation rates (>20% cancellation rate)...");
    
    // Seed 4 more deliveries (total 5: 3 delivered including rapid, 2 cancelled)
    await Delivery.create([
      { student: studentUser._id, vendor: vendorRecord._id, location: "Room 1", totalCost: 100, status: "delivered", createdAt: new Date(), scheduledDate: new Date() },
      { student: studentUser._id, vendor: vendorRecord._id, location: "Room 2", totalCost: 100, status: "delivered", createdAt: new Date(), scheduledDate: new Date() },
      { student: studentUser._id, vendor: vendorRecord._id, location: "Room 4", totalCost: 100, status: "cancelled", createdAt: new Date(), scheduledDate: new Date() },
      { student: studentUser._id, vendor: vendorRecord._id, location: "Room 5", totalCost: 100, status: "cancelled", createdAt: new Date(), scheduledDate: new Date() }
    ]);

    // Clear any previous test cases
    await AuditCase.deleteMany({
      $or: [
        { user: studentUser._id },
        { vendor: vendorRecord._id }
      ]
    });

    // Execute the Fraud Scanner Service
    console.log("\n[Execution] Triggering background Fraud Detection Engine...");
    const checkReport = await fraudDetectionService.runFraudDetectionChecks();

    // Query active audit cases created
    const createdCases = await AuditCase.find({
      $or: [
        { user: studentUser._id },
        { vendor: vendorRecord._id }
      ]
    });

    console.log(`  - Fraud Cases Auto-Created: ${createdCases.length}`);
    for (const c of createdCases) {
      console.log(`    📍 Case: "${c.title}" | Status: ${c.status} | Rules Flagged: ${c.detectedRules.join(', ')}`);
    }

    if (createdCases.length >= 3) {
      console.log("  ✅ FRAUD COMPLIANCE TEST PASSED: All anomalies successfully flagged.");
    } else {
      console.error("  ❌ FRAUD COMPLIANCE TEST FAILED: Missing triggers!");
    }

    // Clean up seeded logs
    await RefundRequest.deleteMany({ student: studentUser._id });
    await Delivery.deleteMany({ vendor: vendorRecord._id });
    await AuditCase.deleteMany({
      $or: [
        { user: studentUser._id },
        { vendor: vendorRecord._id }
      ]
    });

    console.log("\n=======================================================");
    console.log("✅ FRAUD SYSTEM COMPLIANCE TEST SUITE COMPLETE");
    console.log("=======================================================");
    process.exit(0);

  } catch (err) {
    console.error("Fraud testing suite error:", err);
    process.exit(1);
  }
}

runFraudTests();
