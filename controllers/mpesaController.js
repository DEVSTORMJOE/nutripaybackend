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
                const Notification = require('../models/Notification');
                await Notification.create({
                    user: vendorProfile.user,
                    type: 'order',
                    title: 'New Custom Order Paid (M-Pesa)',
                    message: `Custom order ${customOrder.orderId} of KES ${amountPaid} has been paid via M-Pesa.`
                });
            }

            return res.json({ ResponseCode: "0", ResponseDesc: "Success" });
        }

        let depositRecord = await MpesaDeposit.findOne({ checkoutRequestID });

        if (!callbackVerification.success) {
            console.log(`STK Push failed or cancelled. Message: ${callbackVerification.message}`);
            if (depositRecord) {
                depositRecord.status = callbackVerification.resultCode === 1032 ? 'cancelled' : 'failed';
                await depositRecord.save();
            }
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

module.exports = { mpesaDeposit, mpesaCallback, checkMpesaStatus, mpesaWithdraw };
