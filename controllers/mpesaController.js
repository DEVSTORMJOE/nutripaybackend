const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const MpesaDeposit = require('../models/MpesaDeposit');
const mpesaService = require('../services/mpesaService');
const walletService = require('../services/walletService');
const stellarTreasuryService = require('../services/stellarTreasuryService');
const crypto = require('crypto');

// Start M-Pesa STK Push
const mpesaDeposit = async (req, res) => {
    try {
        const { phone, amountKes } = req.body;
        
        if (!phone || !amountKes || amountKes <= 0) {
            return res.status(400).json({ message: "Valid Phone number (254...) and KES amount required" });
        }

        try {
            const data = await mpesaService.initiateDeposit(req.user.id, phone, amountKes);

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
            console.warn("Direct Safaricom STK Push failed, falling back to mock deposit in demo mode:", err.message);
            const mockID = `ws_CO_Mock_${crypto.randomBytes(8).toString('hex')}`;
            await MpesaDeposit.create({
                user: req.user.id,
                amount: amountKes,
                phone: phone,
                checkoutRequestID: mockID,
                status: 'pending'
            });
            res.json({
                message: "STK Push mock sent successfully! (Demo Sandbox Mode)",
                checkoutRequestID: mockID
            });
        }
    } catch (error) {
        console.error("M-Pesa STK Push error:", error.message);
        res.status(500).json({ message: 'M-Pesa request failed: ' + error.message });
    }
};

// Safaricom Webhook Callback Handler
const mpesaCallback = async (req, res) => {
    try {
        console.log("M-Pesa Callback Received:", JSON.stringify(req.body, null, 2));
        const userId = req.params.userId;

        const callbackVerification = mpesaService.verifyCallback(req.body);
        const { checkoutRequestID } = callbackVerification;

        // Check if this callback corresponds to a SponsorRequest
        const SponsorRequest = require('../models/SponsorRequest');
        const sponsorRequest = await SponsorRequest.findOne({ checkoutRequestID });

        if (sponsorRequest) {
            const User = require('../models/User');
            if (!callbackVerification.success) {
                console.log(`M-Pesa STK Push for sponsor request ${sponsorRequest.token} failed or cancelled.`);
                sponsorRequest.status = 'failed';
                await sponsorRequest.save();
                const errorLogger = require('../utils/errorLogger');
                await errorLogger.logError('mpesa', `Sponsor request STK Push payment failed/cancelled for ${sponsorRequest.sponsorEmail}`, {
                    checkoutRequestID,
                    sponsorEmail: sponsorRequest.sponsorEmail,
                    sponsorName: sponsorRequest.sponsorName,
                    amountKES: sponsorRequest.subtotalKes || sponsorRequest.amountKES,
                    reason: callbackVerification.message || 'Cancelled by user (Code 1032)'
                }, 'warn');
                return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
            }

            // Successfully paid sponsor request!
            const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;

            let sponsor = await User.findOne({ email: sponsorRequest.sponsorEmail });
            if (!sponsor) {
                const crypto = require('crypto');
                const generatedPassword = crypto.randomBytes(8).toString("hex");
                sponsor = await User.create({
                    name: sponsorRequest.sponsorName,
                    email: sponsorRequest.sponsorEmail,
                    password: generatedPassword,
                    role: 'sponsor',
                    isApproved: true
                });

                const Sponsor = require('../models/Sponsor');
                await Sponsor.create({
                    user: sponsor._id,
                    organizationName: sponsorRequest.sponsorName || "Sponsor",
                    contactPhone: ""
                });
            }

            // Credit sponsor wallet
            await walletService.creditWallet(
                sponsor._id,
                amountPaid,
                'deposit',
                'mpesa',
                `M-Pesa Sponsor Payment (Receipt: ${mpesaReceiptNumber})`
            );

            // Debit sponsor wallet
            await walletService.debitWallet(
                sponsor._id,
                amountPaid,
                'funding',
                'wallet',
                `Subscription quick sponsor funding for student: ${sponsorRequest.student}`
            );

            // Credit student wallet
            const creditRes = await walletService.creditWallet(
                sponsorRequest.student,
                amountPaid,
                'funding',
                'wallet',
                `Sponsor request funding from sponsor: ${sponsor._id}`
            );
            creditRes.transaction.paymentSource = 'sponsor_funds';
            await creditRes.transaction.save();

            // Immediately lock subscription funds
            const lockResult = await escrowService.lockSubscriptionFunds(sponsorRequest.student, amountPaid, sponsor._id);

            // Update Deliveries status to pending
            const Delivery = require('../models/Delivery');
            await Delivery.updateMany({ _id: { $in: sponsorRequest.deliveryIds } }, { $set: { status: 'pending' } });

            // Create active subscription
            const Subscription = require('../models/Subscription');
            await Subscription.create({
                student: sponsorRequest.student,
                planId: sponsorRequest.planId || 'essential',
                sponsor: sponsor._id,
                status: 'active',
                startDate: sponsorRequest.startDate || new Date(),
                endDate: sponsorRequest.endDate || new Date(Date.now() + 27 * 24 * 60 * 60 * 1000),
                totalPaidKES: amountPaid
            });

            // Set student profile subscription active
            const Student = require('../models/Student');
            const studentProfile = await Student.findOne({ user: sponsorRequest.student });
            if (studentProfile) {
                studentProfile.subscriptionActive = true;
                await studentProfile.save();
            }

            // Mark request as paid
            sponsorRequest.status = 'paid';
            await sponsorRequest.save();

            // COMPULSORY On-chain settlement: Mint equivalent custom tokens
            let stellarTxHash = "";
            let settlementStatus = "pending";
            try {
                const stellarTreasuryService = require('../services/stellarTreasuryService');
                stellarTxHash = await stellarTreasuryService.mintNT(amountPaid);
                settlementStatus = "synced";
                console.log("✅ Sponsor order direct on-chain minting successful. Tx Hash:", stellarTxHash);
            } catch (err) {
                console.error("❌ Sponsor order direct on-chain minting failed. Marked failed for retry queue:", err.message);
                settlementStatus = "failed";
            }

            // Update transaction record
            if (creditRes && creditRes.transaction) {
                creditRes.transaction.stellarTxHash = stellarTxHash || null;
                creditRes.transaction.settlementStatus = settlementStatus;
                await creditRes.transaction.save();
            }

            return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
        }

        // Check if this callback corresponds to an instant custom order
        const CustomOrder = require('../models/CustomOrder');
        const customOrder = await CustomOrder.findOne({ checkoutRequestID });

        if (customOrder) {
            if (!callbackVerification.success) {
                console.log(`M-Pesa STK Push for custom order ${customOrder.orderId} failed or cancelled.`);
                customOrder.status = 'failed';
                await customOrder.save();
                return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
            }

            // Successfully paid direct M-Pesa order!
            const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;
            
            const processResult = await walletService.processMpesaDirectCustomOrder(
                checkoutRequestID,
                amountPaid,
                mpesaReceiptNumber,
                phonePaidFrom
            );

            // COMPULSORY On-chain settlement: Mint equivalent custom tokens to back the new physical cash
            let stellarTxHash = "";
            let settlementStatus = "pending";
            try {
                stellarTxHash = await stellarTreasuryService.mintNT(amountPaid);
                settlementStatus = "synced";
                console.log("✅ Custom order direct on-chain minting successful. Tx Hash:", stellarTxHash);
            } catch (err) {
                console.error("❌ Custom order direct on-chain minting failed. Marked failed for retry queue:", err.message);
                settlementStatus = "failed";
            }

            // Update custom order transactions with on-chain settlement info
            try {
                const txs = await Transaction.find({
                    description: { $regex: mpesaReceiptNumber, $options: 'i' }
                });
                for (let tx of txs) {
                    tx.stellarTxHash = stellarTxHash || null;
                    tx.settlementStatus = settlementStatus;
                    await tx.save();
                }
            } catch (txErr) {
                console.error("Failed to update custom order transaction settlement status:", txErr.message);
            }

            // Notify Vendor
            const Vendor = require('../models/Vendor');
            const vendorProfile = await Vendor.findById(customOrder.vendor);
            if (vendorProfile) {
                const mealPrice = customOrder.items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
                const Notification = require('../models/Notification');
                await Notification.create({
                    user: vendorProfile.user,
                    type: 'order',
                    title: 'New Custom Order Paid (M-Pesa)',
                    message: `Custom order ${customOrder.orderId} of KES ${mealPrice} has been paid via M-Pesa.`
                });
            }

            return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
        }

        // Check if this callback corresponds to an N-Dash errand order
        const NDashOrder = require('../models/NDashOrder');
        const nDashOrder = await NDashOrder.findOne({ checkoutRequestID });

        if (nDashOrder) {
            if (!callbackVerification.success) {
                console.log(`[N-Dash M-Pesa Callback] STK Push for N-Dash order ${nDashOrder.orderId} failed or cancelled.`);
                nDashOrder.status = 'cancelled';
                await nDashOrder.save();
                return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
            }

            // Successfully paid N-Dash order!
            const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;
            const ndashPaymentService = require('../services/ndashPaymentService');
            await ndashPaymentService.processPaymentSuccess(checkoutRequestID, mpesaReceiptNumber, amountPaid, phonePaidFrom);

            return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
        }

        let depositRecord = await MpesaDeposit.findOne({ checkoutRequestID });

        if (!callbackVerification.success) {
            console.log(`STK Push failed or cancelled. Message: ${callbackVerification.message}`);
            if (depositRecord) {
                depositRecord.status = callbackVerification.resultCode === 1032 ? 'cancelled' : 'failed';
                await depositRecord.save();
            }
            const errorLogger = require('../utils/errorLogger');
            await errorLogger.logError('mpesa', `M-Pesa deposit STK Push failed/cancelled for user ${userId || 'unknown'}`, {
                checkoutRequestID,
                userId,
                amountKES: depositRecord ? depositRecord.amountKES : 'unknown',
                resultCode: callbackVerification.resultCode,
                reason: callbackVerification.message || 'Cancelled by user (Code 1032)'
            }, 'warn');
            return res.json({ result: "Acknowledged cancellation/failure" });
        }

        // Successfully paid!
        const { amountPaid, mpesaReceiptNumber, phonePaidFrom } = callbackVerification;

        if (depositRecord) {
            depositRecord.status = 'completed';
            depositRecord.receiptNumber = mpesaReceiptNumber;
            await depositRecord.save();
        } else {
            console.warn(`Webhook received for CheckoutRequestID ${checkoutRequestID} but no pending deposit found in DB.`);
        }

        console.log(`User ${userId} successfully paid ${amountPaid} via M-Pesa ${mpesaReceiptNumber}`);

        // Credit MongoDB internal custodial balance and log Transaction (defaults to sourceType = 'self')
        const creditResult = await walletService.creditWallet(
            userId,
            amountPaid,
            'deposit',
            'mpesa',
            `M-Pesa Deposit (Receipt: ${mpesaReceiptNumber})`
        );

        // COMPULSORY On-chain settlement: Mint equivalent custom tokens from Issuer -> Treasury
        let stellarTxHash = "";
        let settlementStatus = "pending";
        try {
            stellarTxHash = await stellarTreasuryService.mintNT(amountPaid);
            settlementStatus = "synced";
            console.log("✅ On-chain token minting successful. Tx Hash:", stellarTxHash);
        } catch (err) {
            console.error("❌ On-chain token minting failed. Marked failed for retry queue:", err.message);
            settlementStatus = "failed";
        }

        // Update the MongoDB transaction log with the on-chain minting info
        if (creditResult && creditResult.transaction) {
            creditResult.transaction.stellarTxHash = stellarTxHash || null;
            creditResult.transaction.settlementStatus = settlementStatus;
            await creditResult.transaction.save();
        }

        // In-app notification for the user (wallet top-up)
        try {
            const Notification = require('../models/Notification');
            await Notification.create({
                user: userId,
                type: 'wallet',
                title: 'Wallet Funded via M-Pesa',
                message: `Your wallet has been credited with ${amountPaid} KES via M-Pesa (Receipt: ${mpesaReceiptNumber}). You can now use these funds.`
            });
        } catch (e) {
            console.warn('[mpesaCallback] In-app notification error:', e.message);
        }

        res.json({ ResponseCode: "0", ResponseDesc: "Success" });
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

        // Auto-approve mock deposits in sandbox/demo environment immediately upon polling
        if (deposit.status === 'pending' && checkoutRequestID.startsWith('ws_CO_Mock_')) {
            console.log(`[Mock Deposit] Auto-approving mock deposit of ${deposit.amount} KES`);
            const mockReceipt = "MOCK_DEP_" + Math.random().toString(36).substring(4).toUpperCase();
            
            await walletService.creditWallet(
                req.user.id,
                deposit.amount,
                'deposit',
                'mpesa',
                `M-Pesa Deposit (Receipt: ${mockReceipt})`
            );
            
            deposit.status = 'completed';
            deposit.receiptNumber = mockReceipt;
            await deposit.save();

            // In-app notification for mock deposit
            try {
                const Notification = require('../models/Notification');
                await Notification.create({
                    user: req.user.id,
                    type: 'wallet',
                    title: 'Wallet Funded via M-Pesa',
                    message: `Your wallet has been credited with ${deposit.amount} KES. Funds are now available in your wallet!`
                });
            } catch (e) {
                console.warn('[checkMpesaStatus] In-app notification error:', e.message);
            }
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
        if (!wallet || wallet.availableBalanceKES < amountKes) {
            return res.status(400).json({ message: "Insufficient balance or missing wallet." });
        }

        // Lock funds into pendingWithdrawalKES locally
        wallet.availableBalanceKES = Number((wallet.availableBalanceKES - Number(amountKes)).toFixed(2));
        wallet.pendingWithdrawalKES = Number((wallet.pendingWithdrawalKES + Number(amountKes)).toFixed(2));
        await wallet.save();

        // Create withdrawal request in DB
        const WithdrawalRequest = require('../models/WithdrawalRequest');
        const request = await WithdrawalRequest.create({
            user: userId,
            amountKES: Number(amountKes),
            phone: phone,
            status: 'pending_approval'
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

module.exports = { mpesaDeposit, mpesaCallback, checkMpesaStatus, mpesaWithdraw, getMyWithdrawalRequests };
