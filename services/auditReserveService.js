const stellarTreasuryService = require('./stellarTreasuryService');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const AuditCase = require('../models/AuditCase');
const { logAuditEvent } = require('../utils/auditLogger');
const crypto = require('crypto');

/**
 * Move disputed NT on-chain from Treasury, Escrow, Vendor Settlement, or Revenue to Audit Reserve
 */
async function isolateFunds(source, amountKES, caseId, actor, req = null) {
  const amount = parseFloat(amountKES);
  if (amount <= 0 || isNaN(amount)) {
    throw new Error("Invalid isolation amount KES");
  }

  // 1. Determine Source Platform wallet on Stellar
  const platformWallets = stellarTreasuryService.platformWallets;
  let sourceSecret = null;
  let sourcePublic = null;

  if (source === 'treasury') {
    sourceSecret = platformWallets.treasury.secret;
    sourcePublic = platformWallets.treasury.public;
  } else if (source === 'escrow') {
    sourceSecret = platformWallets.escrow.secret;
    sourcePublic = platformWallets.escrow.public;
  } else if (source === 'vendorSettlement') {
    sourceSecret = platformWallets.vendorSettlement.secret;
    sourcePublic = platformWallets.vendorSettlement.public;
  } else if (source === 'revenue') {
    sourceSecret = platformWallets.revenue.secret;
    sourcePublic = platformWallets.revenue.public;
  } else {
    throw new Error("Invalid source platform wallet specified for isolation");
  }

  const auditReservePublic = platformWallets.auditReserve.public;

  // 2. Perform Stellar on-chain transfer
  console.log(`[Audit Reserve] Moving ${amountKES} NT from ${source} to Audit Reserve...`);
  const txHash = await stellarTreasuryService.performPlatformTransfer(
    sourceSecret,
    auditReservePublic,
    amountKES,
    `Isolate Funds: ${source} -> Audit Reserve (Case ID: ${caseId})`
  );

  // 3. Find and update the AuditCase to record the isolated amount
  const auditCase = await AuditCase.findById(caseId);
  if (!auditCase) {
    throw new Error("Audit case not found");
  }

  auditCase.isolatedAmountKES = Number(( (auditCase.isolatedAmountKES || 0) + amount ).toFixed(2));
  auditCase.isolatedSource = source;
  auditCase.auditTrail.push({
    action: 'funds_isolated',
    details: { source, amountKES, txHash },
    timestamp: new Date()
  });
  await auditCase.save();

  // 4. Update the DB caches:
  // If Treasury/Escrow -> adjust Student/Sponsor wallet
  // If VendorSettlement -> adjust Vendor wallet
  if (source === 'treasury' && auditCase.user) {
    const userWallet = await Wallet.findOne({ user: auditCase.user });
    if (userWallet) {
      const avail = parseFloat(userWallet.availableBalanceKES ? userWallet.availableBalanceKES.toString() : '0');
      userWallet.availableBalanceKES = Number(Math.max(0, avail - amount).toFixed(2));
      await userWallet.save();
    }
  } else if (source === 'escrow' && auditCase.user) {
    const userWallet = await Wallet.findOne({ user: auditCase.user });
    if (userWallet) {
      const locked = parseFloat(userWallet.lockedBalanceKES ? userWallet.lockedBalanceKES.toString() : '0');
      userWallet.lockedBalanceKES = Number(Math.max(0, locked - amount).toFixed(2));
      await userWallet.save();
    }
  } else if (source === 'vendorSettlement' && auditCase.vendor) {
    // AuditCase vendor is Vendor document reference. Find the Vendor's user account wallet.
    const Vendor = require('../models/Vendor');
    const vendorRecord = await Vendor.findById(auditCase.vendor);
    const vendorUserId = vendorRecord ? vendorRecord.user : auditCase.vendor;
    const vendorWallet = await Wallet.findOne({ user: vendorUserId });
    if (vendorWallet) {
      const avail = parseFloat(vendorWallet.availableBalanceKES ? vendorWallet.availableBalanceKES.toString() : '0');
      vendorWallet.availableBalanceKES = Number(Math.max(0, avail - amount).toFixed(2));
      await vendorWallet.save();
    }
  }

  // 5. Log immutable AuditEvent
  await logAuditEvent(
    actor,
    'Reserve Isolation',
    'AuditCase',
    [caseId],
    { source, amountKES, txHash, action: 'isolate' },
    req
  );

  return txHash;
}

/**
 * Release isolated funds back from the Audit Reserve to their original pool
 */
async function releaseFunds(caseId, actor, req = null) {
  const auditCase = await AuditCase.findById(caseId);
  if (!auditCase || !auditCase.isolatedAmountKES || auditCase.isolatedAmountKES <= 0) {
    throw new Error("No isolated funds found on this case to release");
  }

  const amountKES = auditCase.isolatedAmountKES;
  const source = auditCase.isolatedSource;

  // 1. Release on-chain: Audit Reserve -> original Source
  const platformWallets = stellarTreasuryService.platformWallets;
  const auditReserveSecret = platformWallets.auditReserve.secret;
  let destinationPublic = null;

  if (source === 'treasury') {
    destinationPublic = platformWallets.treasury.public;
  } else if (source === 'escrow') {
    destinationPublic = platformWallets.escrow.public;
  } else if (source === 'vendorSettlement') {
    destinationPublic = platformWallets.vendorSettlement.public;
  } else if (source === 'revenue') {
    destinationPublic = platformWallets.revenue.public;
  } else {
    throw new Error("Invalid isolated source stored in AuditCase");
  }

  console.log(`[Audit Reserve] Releasing ${amountKES} NT from Audit Reserve to ${source}...`);
  const txHash = await stellarTreasuryService.performPlatformTransfer(
    auditReserveSecret,
    destinationPublic,
    amountKES,
    `Release Funds: Audit Reserve -> ${source} (Case ID: ${caseId})`
  );

  // 2. Restore DB caches
  if (source === 'treasury' && auditCase.user) {
    const userWallet = await Wallet.findOne({ user: auditCase.user });
    if (userWallet) {
      const avail = parseFloat(userWallet.availableBalanceKES ? userWallet.availableBalanceKES.toString() : '0');
      userWallet.availableBalanceKES = Number((avail + amountKES).toFixed(2));
      await userWallet.save();
    }
  } else if (source === 'escrow' && auditCase.user) {
    const userWallet = await Wallet.findOne({ user: auditCase.user });
    if (userWallet) {
      const locked = parseFloat(userWallet.lockedBalanceKES ? userWallet.lockedBalanceKES.toString() : '0');
      userWallet.lockedBalanceKES = Number((locked + amountKES).toFixed(2));
      await userWallet.save();
    }
  } else if (source === 'vendorSettlement' && auditCase.vendor) {
    const Vendor = require('../models/Vendor');
    const vendorRecord = await Vendor.findById(auditCase.vendor);
    const vendorUserId = vendorRecord ? vendorRecord.user : auditCase.vendor;
    const vendorWallet = await Wallet.findOne({ user: vendorUserId });
    if (vendorWallet) {
      const avail = parseFloat(vendorWallet.availableBalanceKES ? vendorWallet.availableBalanceKES.toString() : '0');
      vendorWallet.availableBalanceKES = Number((avail + amountKES).toFixed(2));
      await vendorWallet.save();
    }
  }

  // 3. Update AuditCase status to resolved and log action
  auditCase.isolatedAmountKES = 0;
  auditCase.status = 'Resolved';
  auditCase.auditTrail.push({
    action: 'funds_released',
    details: { source, amountKES, txHash },
    timestamp: new Date()
  });
  await auditCase.save();

  // 4. Log audit event
  await logAuditEvent(
    actor,
    'Reserve Isolation',
    'AuditCase',
    [caseId],
    { source, amountKES, txHash, action: 'release' },
    req
  );

  return txHash;
}

/**
 * Manually create an investigation case linked to specified entities
 */
async function freezeCase(title, description, links = {}, actor, req = null) {
  const caseId = `FC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  
  const auditCase = await AuditCase.create({
    caseId,
    title,
    description,
    user: links.user || null,
    vendor: links.vendor || null,
    transaction: links.transaction || null,
    subscription: links.subscription || null,
    withdrawal: links.withdrawal || null,
    refund: links.refund || null,
    detectedRules: links.rules || [],
    status: 'Open'
  });

  // Log the administrative action in AuditEvent
  await logAuditEvent(
    actor,
    'Fraud Actions',
    'AuditCase',
    [auditCase._id],
    { action: 'create_case', title },
    req
  );

  return auditCase;
}

module.exports = {
  isolateFunds,
  releaseFunds,
  freezeCase
};
