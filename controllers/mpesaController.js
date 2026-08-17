const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const MpesaDeposit = require('../models/MpesaDeposit');
const mpesaService = require('../services/mpesaService');
const walletService = require('../services/walletService');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const crypto = require('crypto');
const { runInTransaction } = require('../utils/transactionHelper');
const queueService = require('../services/queueService');

// Start M-Pesa STK Push
const mpesaDeposit = async (req, res) => {
    try {
        const { phone, amountKes } = req.body;
        
        if (!phone || !amountKes || amountKes <= 0) {
            return res.status(400).json({ message: "Valid Phone number (254...) and KES amount required" });
        }

        try {
            const paymentGatewayService = require('../services/paymentGatewayService');
            const data = await paymentGatewayService.initiateDeposit(req.user.id, phone, amountKes);

            // Save the pending transaction with the CheckoutRequestID
            const checkoutRequestID = data.CheckoutRequestID;
            await MpesaDeposit.create({
                user: req.user.id,
                amount: amountKes,
                phone: phone,
                checkoutRequestID: checkoutRequestID,
                status: 'pending'
            });

            res.json({ message: "STK Push sent successfully to your phone. Waiting for PIN...", checkoutRequestID });
        } catch (err) {
            console.error("Direct Safaricom STK Push failed:", err.message);
            return res.status(500).json({ message: 'M-Pesa STK Push failed: ' + (err.response?.data?.errorMessage || err.message) });
        }
    } catch (error) {
        console.error("M-Pesa STK Push error:", error.message);
        res.status(500).json({ message: 'M-Pesa request failed: ' + error.message });
    }
};

// Safaricom & PayHero Webhook Callback Handler
const mpesaCallback = async (req, res) => {
    try {
        console.log("M-Pesa / PayHero Callback Received:", JSON.stringify(req.body, null, 2));
        const userId = req.params.userId;

        const paymentGatewayService = require('../services/paymentGatewayService');
        const callbackVerification = paymentGatewayService.verifyCallback(req.body);
        const { checkoutRequestID, merchantRequestID, externalReference } = callbackVerification;

        // Perform early check for idempotency in Transaction collection
        const queryOr = [];
        if (callbackVerification.success && callbackVerification.mpesaReceiptNumber) {
            queryOr.push({ paymentReference: callbackVerification.mpesaReceiptNumber });
        }

        if (queryOr.length > 0) {
            const existingTx = await Transaction.findOne({ $or: queryOr });
            if (existingTx) {
                console.log(`[Idempotency Warning] Webhook already processed for payment reference: ${callbackVerification.mpesaReceiptNumber}`);
                return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
            }
        }

        const mongoose = require('mongoose');
        const escrowService = require('../services/escrowService');

        // Run the state changes inside an atomic transaction session
        const result = await runInTransaction(async (session) => {
            // Check if this callback corresponds to a SponsorRequest
            const SponsorRequest = require('../models/SponsorRequest');
            const sponsorQuery = [{ checkoutRequestID }];
            if (merchantRequestID) sponsorQuery.push({ checkoutRequestID: merchantRequestID });
            if (externalReference) sponsorQuery.push({ checkoutRequestID: externalReference });
            const sponsorRequest = session
                ? await SponsorRequest.findOne({ $or: sponsorQuery }).session(session)
                : await SponsorRequest.findOne({ $or: sponsorQuery });

            if (sponsorRequest) {
                const User = require('../models/User');
                if (!callbackVerification.success) {
                    console.log(`M-Pesa STK Push for sponsor request ${sponsorRequest.token} failed or cancelled.`);
                    sponsorRequest.status = callbackVerification.resultCode === 1032 ? 'cancelled' : 'failed';
                    await sponsorRequest.save(session ? { session } : {});
                    const errorLogger = require('../utils/errorLogger');
                    await errorLogger.logError('mpesa', `Sponsor request STK Push payment failed/cancelled for ${sponsorRequest.sponsorEmail}`, {
                        checkoutRequestID,
                        sponsorEmail: sponsorRequest.sponsorEmail,
                        sponsorName: sponsorRequest.sponsorName,
                        amountKES: sponsorRequest.subtotalKes || sponsorRequest.amountKES,
                        reason: callbackVerification.message || 'Cancelled by user (Code 1032)'
                    }, 'warn');
                    return { response: { ResponseCode: "0", ResponseDesc: "Success" } };
                }

                // Successfully paid sponsor request!
                const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;

                let sponsor = session
                    ? await User.findOne({ email: sponsorRequest.sponsorEmail }).session(session)
                    : await User.findOne({ email: sponsorRequest.sponsorEmail });
                if (!sponsor) {
                    const crypto = require('crypto');
                    const generatedPassword = crypto.randomBytes(8).toString("hex");
                    const userDocs = [{
                        name: sponsorRequest.sponsorName,
                        email: sponsorRequest.sponsorEmail,
                        password: generatedPassword,
                        role: 'sponsor',
                        isApproved: true
                    }];
                    const createdUsers = session
                        ? await User.create(userDocs, { session })
                        : await User.create(userDocs);
                    sponsor = createdUsers[0];

                    const Sponsor = require('../models/Sponsor');
                    const sponsorDocs = [{
                        user: sponsor._id,
                        organizationName: sponsorRequest.sponsorName || "Sponsor",
                        contactPhone: ""
                    }];
                    if (session) {
                        await Sponsor.create(sponsorDocs, { session });
                    } else {
                        await Sponsor.create(sponsorDocs);
                    }
                }

                const extraFields = {
                    checkoutRequestId: checkoutRequestID,
                    merchantRequestId: merchantRequestID,
                    paymentReference: mpesaReceiptNumber
                };

                // Credit sponsor wallet
                await walletService.creditWallet(
                    sponsor._id,
                    amountPaid,
                    'deposit',
                    'mpesa',
                    `M-Pesa Sponsor Payment (Receipt: ${mpesaReceiptNumber})`,
                    'self',
                    false,
                    'none',
                    session,
                    false,
                    extraFields
                );

                // Debit sponsor wallet
                await walletService.debitWallet(
                    sponsor._id,
                    amountPaid,
                    'funding',
                    'wallet',
                    `Subscription quick sponsor funding for student: ${sponsorRequest.student}`,
                    false,
                    session,
                    { externalReference: mpesaReceiptNumber }
                );

                // Credit student wallet
                const creditRes = await walletService.creditWallet(
                    sponsorRequest.student,
                    amountPaid,
                    'funding',
                    'wallet',
                    `Sponsor request funding from sponsor: ${sponsor._id}`,
                    'sponsor',
                    true,
                    'subscription_only',
                    session,
                    false,
                    { externalReference: mpesaReceiptNumber }
                );
                creditRes.transaction.paymentSource = 'sponsor_funds';
                await creditRes.transaction.save(session ? { session } : {});

                // Log audit event for sponsor funding
                const AuditLog = require('../models/AuditLog');
                await AuditLog.create([{
                    action: 'sponsor_funding',
                    user: sponsor._id,
                    details: {
                        studentId: sponsorRequest.student,
                        amountKES: amountPaid,
                        mpesaReceiptNumber,
                        sponsorRequestToken: sponsorRequest.token
                    }
                }], session ? { session } : {});

                // Immediately lock subscription funds
                await escrowService.lockSubscriptionFunds(sponsorRequest.student, amountPaid, sponsor._id, session);

                // Create active subscription
                const Subscription = require('../models/Subscription');
                const subDocs = [{
                    student: sponsorRequest.student,
                    planId: sponsorRequest.planId || 'essential',
                    sponsor: sponsor._id,
                    status: 'active',
                    startDate: sponsorRequest.startDate || new Date(),
                    endDate: sponsorRequest.endDate || new Date(Date.now() + 27 * 24 * 60 * 60 * 1000),
                    totalPaidKES: amountPaid
                }];
                const createdSubs = session
                    ? await Subscription.create(subDocs, { session })
                    : await Subscription.create(subDocs);
                const activeSubscription = createdSubs[0];

                // Update Deliveries status to pending and link subscription
                const Delivery = require('../models/Delivery');
                if (session) {
                    await Delivery.updateMany(
                        { _id: { $in: sponsorRequest.deliveryIds } },
                        { $set: { status: 'pending', subscription: activeSubscription._id } }
                    ).session(session);
                } else {
                    await Delivery.updateMany(
                        { _id: { $in: sponsorRequest.deliveryIds } },
                        { $set: { status: 'pending', subscription: activeSubscription._id } }
                    );
                }

                // Set student profile subscription active
                const Student = require('../models/Student');
                const studentProfile = session
                    ? await Student.findOne({ user: sponsorRequest.student }).session(session)
                    : await Student.findOne({ user: sponsorRequest.student });
                if (studentProfile) {
                    studentProfile.subscriptionActive = true;
                    await studentProfile.save(session ? { session } : {});
                }

                // Mark request as paid
                sponsorRequest.status = 'paid';
                await sponsorRequest.save(session ? { session } : {});

                return {
                    response: { ResponseCode: "0", ResponseDesc: "Success" },
                    needsMint: true,
                    amount: amountPaid,
                    mpesaReceiptNumber,
                    transactionToUpdate: creditRes.transaction._id
                };
            }

            // Check if this callback corresponds to an instant custom order
            const CustomOrder = require('../models/CustomOrder');
            const customOrderQuery = [{ checkoutRequestID }];
            if (merchantRequestID) customOrderQuery.push({ checkoutRequestID: merchantRequestID });
            if (externalReference) customOrderQuery.push({ checkoutRequestID: externalReference });
            const customOrder = session
                ? await CustomOrder.findOne({ $or: customOrderQuery }).session(session)
                : await CustomOrder.findOne({ $or: customOrderQuery });

            if (customOrder) {
                if (!callbackVerification.success) {
                    console.log(`M-Pesa STK Push for custom order ${customOrder.orderId} failed or cancelled.`);
                    customOrder.status = 'failed';
                    await customOrder.save(session ? { session } : {});
                    return { response: { ResponseCode: "0", ResponseDesc: "Success" } };
                }

                // Successfully paid direct M-Pesa order!
                const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;
                
                const directRes = await walletService.processMpesaDirectCustomOrder(
                    customOrder.checkoutRequestID || checkoutRequestID,
                    amountPaid,
                    mpesaReceiptNumber,
                    phonePaidFrom,
                    session
                );

                return {
                    response: { ResponseCode: "0", ResponseDesc: "Success" },
                    needsMint: true,
                    amount: amountPaid,
                    mpesaReceiptNumber,
                    transactionToUpdate: directRes?.createdTx?._id || directRes?.createdTx?.transactionId,
                    customOrderId: customOrder.orderId,
                    vendorId: customOrder.vendor
                };
            }

            // Check if this callback corresponds to an N-Dash errand order
            const NDashOrder = require('../models/NDashOrder');
            const ndashQuery = [{ checkoutRequestID }];
            if (merchantRequestID) ndashQuery.push({ checkoutRequestID: merchantRequestID });
            if (externalReference) ndashQuery.push({ checkoutRequestID: externalReference });
            const nDashOrder = session
                ? await NDashOrder.findOne({ $or: ndashQuery }).session(session)
                : await NDashOrder.findOne({ $or: ndashQuery });

            if (nDashOrder) {
                if (!callbackVerification.success) {
                    console.log(`[N-Dash M-Pesa Callback] STK Push for N-Dash order ${nDashOrder.orderId} failed or cancelled.`);
                    nDashOrder.status = 'cancelled';
                    await nDashOrder.save(session ? { session } : {});
                    return { response: { ResponseCode: "0", ResponseDesc: "Success" } };
                }

                // Successfully paid N-Dash order!
                const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;
                const ndashPaymentService = require('../services/ndashPaymentService');
                await ndashPaymentService.processPaymentSuccess(nDashOrder.checkoutRequestID || checkoutRequestID, mpesaReceiptNumber, amountPaid, phonePaidFrom, session);

                return {
                    response: { ResponseCode: "0", ResponseDesc: "Success" }
                };
            }

            const depositQuery = [{ checkoutRequestID }];
            if (merchantRequestID) depositQuery.push({ checkoutRequestID: merchantRequestID });
            if (externalReference) depositQuery.push({ checkoutRequestID: externalReference });
            let depositRecord = session
                ? await MpesaDeposit.findOne({ $or: depositQuery }).session(session)
                : await MpesaDeposit.findOne({ $or: depositQuery });

            if (!callbackVerification.success) {
                console.log(`STK Push failed or cancelled. Message: ${callbackVerification.message}`);
                if (depositRecord) {
                    depositRecord.status = callbackVerification.resultCode === 1032 ? 'cancelled' : 'failed';
                    await depositRecord.save(session ? { session } : {});
                }
                const errorLogger = require('../utils/errorLogger');
                await errorLogger.logError('mpesa', `M-Pesa deposit STK Push failed/cancelled for user ${userId || 'unknown'}`, {
                    checkoutRequestID,
                    userId,
                    amountKES: depositRecord ? depositRecord.amountKES : 'unknown',
                    resultCode: callbackVerification.resultCode,
                    reason: callbackVerification.message || 'Cancelled by user (Code 1032)'
                }, 'warn');
                return { response: { result: "Acknowledged cancellation/failure" } };
            }

            // Successfully paid standard deposit!
            const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;

            // 1. REPLAY ATTACK PREVENTION: Atomic state transition on MpesaDeposit
            if (session) {
                depositRecord = await MpesaDeposit.findOneAndUpdate(
                    { checkoutRequestID, status: 'pending' },
                    { $set: { status: 'completed', receiptNumber: mpesaReceiptNumber } },
                    { new: true }
                ).session(session);
            } else {
                depositRecord = await MpesaDeposit.findOneAndUpdate(
                    { checkoutRequestID, status: 'pending' },
                    { $set: { status: 'completed', receiptNumber: mpesaReceiptNumber } },
                    { new: true }
                );
            }

            if (!depositRecord) {
                console.warn(`[REPLAY DETECTED] Webhook replayed for CheckoutRequestID ${checkoutRequestID}. Already completed or invalid.`);
                return { response: { ResponseCode: "0", ResponseDesc: "Already processed" }, needsMint: false };
            }

            // 2. REPLAY ATTACK PREVENTION: Check if PaymentReference (mpesaReceiptNumber) was already processed
            if (mpesaReceiptNumber) {
                const existingTx = await Transaction.findOne({
                    $or: [
                        { description: { $regex: mpesaReceiptNumber, $options: 'i' } },
                        { paymentReference: mpesaReceiptNumber }
                    ]
                });
                if (existingTx) {
                    console.warn(`[REPLAY DETECTED] Webhook replayed. Payment reference/receipt ${mpesaReceiptNumber} already used.`);
                    return { response: { ResponseCode: "0", ResponseDesc: "Duplicate reference" }, needsMint: false };
                }
            }

            const extraFields = {
                checkoutRequestId: checkoutRequestID,
                merchantRequestId: merchantRequestID,
                paymentReference: mpesaReceiptNumber
            };

            const creditResult = await walletService.creditWallet(
                userId,
                amountPaid,
                'deposit',
                'mpesa',
                `M-Pesa Deposit (Receipt: ${mpesaReceiptNumber})`,
                'self',
                false,
                'none',
                session,
                false,
                extraFields
            );

            return {
                response: { ResponseCode: "0", ResponseDesc: "Success" },
                needsMint: true,
                amount: amountPaid,
                mpesaReceiptNumber,
                transactionToUpdate: creditResult.transaction ? creditResult.transaction._id : null,
                userId
            };
        });

        // After transaction session completes successfully, trigger on-chain minting outside the session block!
        if (result && result.needsMint) {
            const { amount, transactionToUpdate, mpesaReceiptNumber, customOrderId, vendorId, userId: notifyUserId } = result;
            
            try {
                let txId = transactionToUpdate;
                if (!txId && mpesaReceiptNumber) {
                    const foundTx = await Transaction.findOne({ description: { $regex: mpesaReceiptNumber, $options: 'i' } });
                    if (foundTx) txId = foundTx._id;
                }

                if (txId) {
                    // Update to pending first to show it's in the queue
                    await Transaction.findByIdAndUpdate(txId, { $set: { settlementStatus: 'pending' } });
                    
                    // Queue the minting job!
                    await queueService.addStellarJob('mpesa_direct_order', txId, { amountKES: amount });
                    console.log(`[Mpesa Controller] Enqueued mint job for transaction ${txId}`);
                } else {
                    console.warn(`[Mpesa Controller] Could not find transaction associated with receipt ${mpesaReceiptNumber} to queue.`);
                }
            } catch (queueErr) {
                console.error("[Mpesa Controller] Failed to enqueue on-chain minting job:", queueErr.message);
                
                // Fallback to old behavior: run mintNT synchronously
                try {
                    console.log("[Mpesa Controller] Running synchronous mint fallback...");
                    const stellarTxHash = await stellarTreasuryService.mintNT(amount);
                    if (transactionToUpdate) {
                        await Transaction.findByIdAndUpdate(transactionToUpdate, {
                            $set: { stellarTxHash, settlementStatus: 'synced' }
                        });
                    }
                } catch (fallbackErr) {
                    console.error("[Mpesa Controller] Fallback synchronous mint failed:", fallbackErr.message);
                    if (transactionToUpdate) {
                        await Transaction.findByIdAndUpdate(transactionToUpdate, {
                            $set: { settlementStatus: 'failed' }
                        });
                    }
                }
            }

            if (customOrderId && vendorId) {
                try {
                    const Vendor = require('../models/Vendor');
                    const vendorProfile = await Vendor.findById(vendorId);
                    if (vendorProfile) {
                        const Notification = require('../models/Notification');
                        await Notification.create({
                            user: vendorProfile.user,
                            type: 'order',
                            title: 'New Custom Order Paid (M-Pesa)',
                            message: `Custom order ${customOrderId} of KES ${amount} has been paid via M-Pesa.`
                        });
                    }
                } catch (notiErr) {
                    console.warn('[mpesaCallback] Vendor notification failed:', notiErr.message);
                }
            } else if (notifyUserId) {
                try {
                    const Notification = require('../models/Notification');
                    await Notification.create({
                        user: notifyUserId,
                        type: 'wallet',
                        title: 'Wallet Funded via M-Pesa',
                        message: `Your wallet has been credited with ${amount} KES via M-Pesa (Receipt: ${mpesaReceiptNumber}). You can now use these funds.`
                    });
                } catch (notiErr) {
                    console.warn('[mpesaCallback] In-app notification failed:', notiErr.message);
                }
            }
        }

        return res.json(result?.response || { ResponseCode: "0", ResponseDesc: "Success" });
    } catch (e) {
        console.error("Mpesa Callback processing error:", e);
        res.status(500).json({ ResponseCode: "1", ResponseDesc: "Internal Server Error" });
    }
};

// Check M-Pesa Transaction Status
const checkMpesaStatus = async (req, res) => {
    try {
        const { checkoutRequestID } = req.params;
        const deposit = await MpesaDeposit.findOne({ checkoutRequestID, user: req.user.id });
        
        if (!deposit) {
            return res.status(404).json({ message: "M-Pesa transaction not found" });
        }

        res.json({ status: deposit.status, amount: deposit.amount, receipt: deposit.receiptNumber });
    } catch (e) {
        console.error("Status check error:", e);
        res.status(500).json({ message: "Internal server error" });
    }
}

// M-Pesa B2C Payout Request (Awaiting Admin Approval)
const mpesaWithdraw = async (req, res) => {
    try {
        const { phone, amountKes } = req.body;
        const userId = req.user.id;

        if (!phone || !amountKes || amountKes <= 0) {
            return res.status(400).json({ message: "Valid Phone number (254...) and KES amount required" });
        }

        const wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            return res.status(400).json({ message: "User wallet not found." });
        }

        const currentAvail = parseFloat(wallet.availableBalanceKES ? wallet.availableBalanceKES.toString() : '0');
        if (currentAvail < parseFloat(amountKes)) {
            return res.status(400).json({ message: "Insufficient balance." });
        }

        // Lock funds into pendingWithdrawalKES locally
        wallet.availableBalanceKES = mongoose.Types.Decimal128.fromString((currentAvail - parseFloat(amountKes)).toFixed(2));
        const currentPending = parseFloat(wallet.pendingWithdrawalKES ? wallet.pendingWithdrawalKES.toString() : '0');
        wallet.pendingWithdrawalKES = mongoose.Types.Decimal128.fromString((currentPending + parseFloat(amountKes)).toFixed(2));
        await wallet.save();

        // Create withdrawal request in DB
        const WithdrawalRequest = require('../models/WithdrawalRequest');
        const request = await WithdrawalRequest.create({
            user: userId,
            amountKES: mongoose.Types.Decimal128.fromString(parseFloat(amountKes).toFixed(2)),
            phone: phone,
            status: 'requested'
        });

        res.json({ 
            message: `Withdrawal request of ${amountKes} KES submitted successfully. It is now awaiting administrator approval.`,
            requestId: request._id
        });
    } catch (e) {
        console.error("M-Pesa Withdraw request error:", e);
        res.status(500).json({ message: "Internal server error submitting withdrawal request: " + e.message });
    }
}

const getMyWithdrawalRequests = async (req, res) => {
    try {
        const WithdrawalRequest = require('../models/WithdrawalRequest');
        const requests = await WithdrawalRequest.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(requests);
    } catch (e) {
        console.error("Failed to fetch my withdrawals:", e);
        res.status(500).json({ message: "Failed to load withdrawal requests: " + e.message });
    }
}

// Safaricom Webhook B2C Callback Handler
const mpesaB2CCallback = async (req, res) => {
    try {
        console.log("M-Pesa B2C Callback Received:", JSON.stringify(req.body, null, 2));
        const result = req.body.Result || req.body.Body?.stkCallback; // fallback to body wrapper if nested
        if (!result) {
            return res.status(400).json({ message: "Invalid B2C callback body" });
        }

        const conversationId = result.ConversationID;
        const originatorConversationId = result.OriginatorConversationID;
        const resultCode = result.ResultCode;

        const mongoose = require('mongoose');
        const WithdrawalRequest = require('../models/WithdrawalRequest');
        const request = await WithdrawalRequest.findOne({
            $or: [
                { conversationId: conversationId },
                { originatorConversationId: originatorConversationId }
            ]
        }).populate('user');

        if (!request) {
            console.warn(`[B2C Callback] No matching withdrawal request found for ConversationID: ${conversationId}`);
            return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
        }

        if (resultCode !== 0) {
            console.log(`[B2C Callback] Withdrawal failed. Resetting status to requested. Code: ${resultCode}`);
            request.status = 'requested';
            await request.save();
            return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
        }

        // Payout succeeded! Transition to b2c_success
        console.log(`[B2C Callback] Withdrawal succeeded. Processing final account payouts.`);
        request.status = 'b2c_success';
        await request.save();

        // Move funds from pendingWithdrawalKES to totalWithdrawnKES
        const Wallet = require('../models/Wallet');
        const wallet = await Wallet.findOne({ user: request.user._id });
        if (wallet) {
            const pending = parseFloat(wallet.pendingWithdrawalKES ? wallet.pendingWithdrawalKES.toString() : '0');
            const withdrawn = parseFloat(wallet.totalWithdrawnKES ? wallet.totalWithdrawnKES.toString() : '0');
            const amount = parseFloat(request.amountKES.toString());

            wallet.pendingWithdrawalKES = mongoose.Types.Decimal128.fromString((pending - amount).toFixed(2));
            wallet.totalWithdrawnKES = mongoose.Types.Decimal128.fromString((withdrawn + amount).toFixed(2));
            await wallet.save();

            // Stellar Mirror transfer (Stellar custody payout Vendor -> Treasury)
            let stellarTxHash = "";
            let settlementStatus = "pending";
            try {
                const stellarTreasuryService = require('../services/stellarTreasuryService');
                stellarTxHash = await stellarTreasuryService.moveVendorToTreasury(amount);
                settlementStatus = "synced";
                console.log("✅ On-chain token redemption successful. Tx Hash:", stellarTxHash);
            } catch (err) {
                console.error("❌ Failed to mirror withdrawal back to Treasury on Stellar:", err.message);
                settlementStatus = "failed";
            }

            // Create Transaction log
            const txId = crypto.randomUUID();
            await Transaction.create([{
                transactionId: txId,
                fromUser: request.user._id,
                amountKES: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
                transactionCategory: 'withdrawal',
                paymentMethod: 'stellar',
                stellarTxHash: stellarTxHash || null,
                status: 'completed',
                settlementStatus: settlementStatus,
                description: `M-Pesa Payout to ${request.phone} (Completed)`
            }]);

            // Log LedgerEntry
            try {
                const ledgerService = require('../services/ledgerService');
                await ledgerService.recordLedgerEntry({
                    debitWallet: wallet._id,
                    creditWallet: null,
                    amountKES: mongoose.Types.Decimal128.fromString(amount.toFixed(2)),
                    transactionId: txId,
                    reference: `M-Pesa B2C Withdrawal Completed (Receipt: B2C_Success)`,
                    ledgerType: 'withdrawal'
                });
            } catch (ledgerErr) {
                console.error("Ledger log failed in mpesaB2CCallback:", ledgerErr.message);
            }

            // Log permanent AuditLog
            try {
                const AuditLog = require('../models/AuditLog');
                await AuditLog.create([{
                    action: 'withdrawal_approval',
                    user: request.approvedBy || request.user._id,
                    details: {
                        withdrawalRequestId: request._id,
                        amountKES: amount,
                        phone: request.phone,
                        stellarTxHash
                    }
                }]);
            } catch (auditErr) {
                console.error("Audit log failed in mpesaB2CCallback:", auditErr.message);
            }
        }

        request.status = 'completed';
        await request.save();

        return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
  } catch (err) {
        console.error("B2C Callback handler error:", err);
        return res.status(500).json({ ResponseCode: "1", ResponseDesc: "Internal Server Error" });
  }
};

module.exports = { mpesaDeposit, mpesaCallback, checkMpesaStatus, mpesaWithdraw, getMyWithdrawalRequests, mpesaB2CCallback };
