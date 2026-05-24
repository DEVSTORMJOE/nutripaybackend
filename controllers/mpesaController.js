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
            
            await walletService.processMpesaDirectCustomOrder(
                checkoutRequestID,
                amountPaid,
                mpesaReceiptNumber,
                phonePaidFrom
            );

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

        // Credit MongoDB internal custodial balance and log Transaction
        await walletService.creditWallet(
            userId,
            amountPaid,
            'deposit',
            'mpesa',
            `M-Pesa Deposit (Receipt: ${mpesaReceiptNumber})`
        );

        // Optional: Perform internal Stellar Treasury settlement to mirror fiat deposit on ledger.
        // For prototype, we can transfer from Issuer -> Treasury on-chain to mint equivalent token.
        if (stellarTreasuryService.platformWallets.issuer.secret) {
            try {
                await stellarTreasuryService.settleToEscrow(amountPaid); // Mock mint or treasury allocation
                console.log("On-chain treasury mirror successful.");
            } catch (err) {
                console.error("On-chain treasury mirror failed. Local balance is credited anyway:", err.message);
            }
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

// M-Pesa B2C Payout (Withdrawal)
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
        wallet.availableBalanceKES -= Number(amountKes);
        wallet.pendingWithdrawalKES += Number(amountKes);
        await wallet.save();

        // Dispatch B2C payout to user's phone via Safaricom Daraja API
        let payoutResult;
        try {
            payoutResult = await mpesaService.withdrawToMpesa(phone, amountKes);
        } catch (payoutErr) {
            // Rollback local locking on payout failure
            wallet.availableBalanceKES += Number(amountKes);
            wallet.pendingWithdrawalKES -= Number(amountKes);
            await wallet.save();
            throw payoutErr;
        }

        // Deduct from pending withdrawal and mark completed
        wallet.pendingWithdrawalKES -= Number(amountKes);
        wallet.totalWithdrawnKES += Number(amountKes);
        await wallet.save();

        // Perform Stellar Mirror Payout: Vendor Settlement -> Treasury
        let stellarTxHash = "";
        try {
            // Transfer from Vendor Settlement -> Treasury on-chain to balance platform reserves
            stellarTxHash = await stellarTreasuryService.reverseSettlement(amountKes); // Settle back
        } catch (err) {
            console.error("Failed to mirror withdrawal back to Admin Escrow/Treasury on Stellar:", err.message);
        }

        // Create transaction log
        await Transaction.create({
            transactionId: crypto.randomUUID(),
            fromUser: userId,
            amountKES: amountKes,
            transactionCategory: 'withdrawal',
            paymentMethod: 'mpesa',
            stellarTxHash: stellarTxHash || null,
            status: 'completed',
            description: `M-Pesa Payout to ${phone}`
        });

        res.json({ message: `Successfully withdrew ${amountKes} KES to M-Pesa ${phone}.` });
    } catch (e) {
        console.error("M-Pesa Withdraw error:", e);
        res.status(500).json({ message: "Internal server error during payout: " + e.message });
    }
}

module.exports = { mpesaDeposit, mpesaCallback, checkMpesaStatus, mpesaWithdraw };
