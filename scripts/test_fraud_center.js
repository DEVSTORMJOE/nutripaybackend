const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const AuditCase = require('../models/AuditCase');
const User = require('../models/User');
const Vendor = require('../models/Vendor');

async function testFraudCenter() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nutripay');
    console.log("Connected to MongoDB for Fraud Center Verification.");

    // Seed test cases if empty
    const caseCount = await AuditCase.countDocuments();
    console.log(`Current Audit Cases in DB: ${caseCount}`);

    if (caseCount === 0) {
      console.log("Seeding test cases with risk scores...");
      const dummyUser = await User.findOne({ role: 'student' });
      const dummyVendor = await Vendor.findOne();

      await AuditCase.create([
        {
          caseId: 'FC-TEST-001',
          title: 'Refund Velocity Abuse Detected',
          description: 'User requested 4 refunds within 24 hours',
          status: 'Open',
          severity: 'HIGH',
          riskScore: 85,
          detectedRules: ['Refund Abuse'],
          user: dummyUser ? dummyUser._id : null,
          assignedInvestigator: 'Unassigned'
        },
        {
          caseId: 'FC-TEST-002',
          title: 'Withdrawal Velocity Abuse Detected',
          description: 'Single high-value withdrawal > 10,000 KES',
          status: 'Investigating',
          severity: 'CRITICAL',
          riskScore: 92,
          detectedRules: ['Withdrawal Abuse'],
          user: dummyUser ? dummyUser._id : null,
          assignedInvestigator: 'admin@nutripay.com'
        },
        {
          caseId: 'FC-TEST-003',
          title: 'Abnormally High Vendor Cancellation Rate',
          description: 'Vendor cancellation rate at 28%',
          status: 'Resolved',
          severity: 'MEDIUM',
          riskScore: 65,
          detectedRules: ['Vendor Abuse'],
          vendor: dummyVendor ? dummyVendor._id : null,
          assignedInvestigator: 'admin@nutripay.com'
        }
      ]);
      console.log("Test cases seeded successfully.");
    }

    const cases = await AuditCase.find();
    console.log("Sample case risk scores:", cases.map(c => ({ id: c.caseId, score: c.riskScore, severity: c.severity, status: c.status })));
    console.log("✅ Fraud Center schema & seeding verified successfully!");

    await mongoose.disconnect();
  } catch (err) {
    console.error("Verification failed:", err);
    process.exit(1);
  }
}

testFraudCenter();
