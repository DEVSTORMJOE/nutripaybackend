const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const AuditCase = require('../models/AuditCase');
const AuditEvent = require('../models/AuditEvent');

const auditController = require('../controllers/auditController');

function makeMockRes() {
  const res = {
    statusVal: 200,
    headers: {},
    bodyData: null,
    status(code) {
      this.statusVal = code;
      return this;
    },
    json(obj) {
      this.bodyData = obj;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(data) {
      this.bodyData = data;
    }
  };
  return res;
}

async function runAuditControllerTests() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nutripay');
    console.log("Connected to MongoDB for Audit Center Controller Tests.");

    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      adminUser = await User.create({
        name: 'Audit Manager',
        email: 'manager@nutripay.local',
        password: 'Password123',
        role: 'admin'
      });
    }

    console.log("\n=======================================================");
    console.log("🛡️  RUNNING INTEGRATION TEST: AUDIT CENTER ENDPOINTS");
    console.log("=======================================================");

    // ----------------------------------------------------
    // TEST 1: GET Audit Dashboard
    // ----------------------------------------------------
    console.log("\n[Test 1] Invoking getAuditDashboard handler...");
    const reqDash = { user: adminUser };
    const resDash = makeMockRes();
    await auditController.getAuditDashboard(reqDash, resDash);
    
    console.log(`  - Status Code: ${resDash.statusVal}`);
    console.log(`  - Counters returned: ${JSON.stringify(resDash.bodyData?.counters)}`);
    console.log(`  - PoR Success Status: ${resDash.bodyData?.reserveHealth?.success}`);

    if (resDash.statusVal === 200 && resDash.bodyData?.counters) {
      console.log("  ✅ TEST 1 PASSED");
    } else {
      console.error("  ❌ TEST 1 FAILED");
    }

    // ----------------------------------------------------
    // TEST 2: GET Audit Cases
    // ----------------------------------------------------
    console.log("\n[Test 2] Invoking getAuditCases handler...");
    const reqCases = { user: adminUser };
    const resCases = makeMockRes();
    await auditController.getAuditCases(reqCases, resCases);

    console.log(`  - Status Code: ${resCases.statusVal}`);
    console.log(`  - Cases Count: ${resCases.bodyData?.length}`);
    if (resCases.statusVal === 200) {
      console.log("  ✅ TEST 2 PASSED");
    } else {
      console.error("  ❌ TEST 2 FAILED");
    }

    // ----------------------------------------------------
    // TEST 3: Create, Note & Action a Manual Case
    // ----------------------------------------------------
    console.log("\n[Test 3] Simulating manual case handling workflow...");
    
    // Create manual case via service
    const auditReserveService = require('../services/auditReserveService');
    const tempCase = await auditReserveService.freezeCase(
      "Test Security Case", 
      "Testing manual actions", 
      { rules: ["Manual Flag"] }, 
      adminUser.id
    );

    // Call add note action
    const reqNote = {
      params: { id: tempCase._id },
      body: { action: 'add_note', note: 'Securely audited and flagged for check.' },
      user: adminUser
    };
    const resNote = makeMockRes();
    await auditController.handleCaseAction(reqNote, resNote);
    console.log(`  - Add Note Result: status=${resNote.statusVal}, msg="${resNote.bodyData?.message}"`);

    // Call status change
    const reqStatus = {
      params: { id: tempCase._id },
      body: { action: 'status_change', status: 'Investigating' },
      user: adminUser
    };
    const resStatus = makeMockRes();
    await auditController.handleCaseAction(reqStatus, resStatus);
    console.log(`  - Status Change Result: status=${resStatus.statusVal}, newStatus="${resStatus.bodyData?.auditCase?.status}"`);

    if (resNote.statusVal === 200 && resStatus.bodyData?.auditCase?.status === 'Investigating') {
      console.log("  ✅ TEST 3 PASSED");
    } else {
      console.error("  ❌ TEST 3 FAILED");
    }

    // Clean up temporary case
    await AuditCase.deleteOne({ _id: tempCase._id });

    // ----------------------------------------------------
    // TEST 4: CSV Export Formatting
    // ----------------------------------------------------
    console.log("\n[Test 4] Invoking exportSnapshotsCSV handler...");
    const reqExport = { user: adminUser };
    const resExport = makeMockRes();
    await auditController.exportSnapshotsCSV(reqExport, resExport);

    console.log(`  - Status Code: ${resExport.statusVal}`);
    console.log(`  - Header: ${resExport.headers['Content-Disposition']}`);
    console.log(`  - Data Preview:\n${String(resExport.bodyData).split('\n').slice(0, 3).join('\n')}`);

    if (resExport.statusVal === 200 && String(resExport.bodyData).startsWith("Date,")) {
      console.log("  ✅ TEST 4 PASSED");
    } else {
      console.error("  ❌ TEST 4 FAILED");
    }

    // ----------------------------------------------------
    // TEST 5: Immutable Event Log Integrity
    // ----------------------------------------------------
    console.log("\n[Test 5] Validating append-only immutability constraint on AuditEvent...");

    // Create an event
    const event = await AuditEvent.create({
      actor: adminUser.id,
      action: 'Test Audit Log Event',
      entity: 'SystemTest',
      ip: '127.0.0.1',
      metadata: { test: true }
    });

    // Try modifying it
    let updateFailed = false;
    try {
      event.action = "Modified Action Name";
      await event.save();
    } catch (err) {
      updateFailed = true;
      console.log(`  - Blocked save modification update: "${err.message}"`);
    }

    // Try deleting it
    let deleteFailed = false;
    try {
      await AuditEvent.deleteOne({ _id: event._id });
    } catch (err) {
      deleteFailed = true;
      console.log(`  - Blocked deleteOne query update: "${err.message}"`);
    }

    // Clean using raw mongoose connection bypass (non-schema raw query if needed for cleanup)
    await mongoose.connection.collection('auditevents').deleteOne({ _id: event._id });

    if (updateFailed && deleteFailed) {
      console.log("  ✅ TEST 5 PASSED: Immutable audit records blocked edits/deletions.");
    } else {
      console.error("  ❌ TEST 5 FAILED: Audit event collection bypass detected!");
    }

    console.log("\n=======================================================");
    console.log("✅ ALL AUDIT DASHBOARD CONTROLLER TESTS COMPLETE");
    console.log("=======================================================");
    process.exit(0);

  } catch (err) {
    console.error("Audit testing suite error:", err);
    process.exit(1);
  }
}

runAuditControllerTests();
