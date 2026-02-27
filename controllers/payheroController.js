const axios = require('axios');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const PayheroDeposit = require('../models/PayheroDeposit');
const stellarService = require('../services/stellarService');
const crypto = require('crypto');

// Start PayHero STK Push
const payheroDeposit = async (req, res) => {
    try {
        const { phone, amountKes } = req.body;
        
        if (!phone || !amountKes || amountKes <= 0) {
            return res.status(400).json({ message: "Valid Phone number (07... or 254...) and KES amount required" });
        }

        const authHeader = process.env.BASIC_AUTH_TOKEN;
        const channelId = process.env.PAYHERO_CHANNEL_ID;

        if (!authHeader || !channelId) {
            return res.status(500).json({ message: "PayHero configuration missing in backend (.env)" });
        }

        // Generate a unique reference for this transaction
        const reference = crypto.randomUUID();

        // The webhook URL should hit the live server
        const baseUrl = process.env.PAYHERO_CALLBACK_URL || 'https://nutripaybackend.onrender.com';
        const callbackUrl = `${baseUrl}/api/payhero/callback/${req.user.id}`;

        const payload = {
            amount: Number(amountKes),
            phone_number: phone,
            channel_id: Number(channelId),
            provider: "m-pesa",
            external_reference: reference,
            callback_url: callbackUrl
        };

        const response = await axios.post(
            "https://backend.payhero.co.ke/api/v2/payments",
            payload,
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": authHeader,
                },
            }
        );

        if (response.data && response.data.success) {
            // Save the pending transaction
            await PayheroDeposit.create({
                user: req.user.id,
                amount: amountKes,
                phone: phone,
                reference: reference,
                status: 'pending'
            });

            res.json({ message: "STK Push sent successfully via PayHero! Check your phone...", reference });
        } else {
            console.error("PayHero Error Response:", response.data);
            res.status(400).json({ message: "PayHero request failed.", details: response.data });
        }
    } catch (error) {
        console.error("PayHero STK Push error:", error.message);
        if (error.response) console.error(error.response.data);
        res.status(500).json({ message: 'PayHero request failed', error: error.message });
    }
};

// PayHero Webhook Callback Handler
const payheroCallback = async (req, res) => {
    try {
        console.log("PayHero Callback Received:", JSON.stringify(req.body, null, 2));
        const userId = req.params.userId;

        const body = req.body.response;
        if (!body) {
            return res.json({ result: "Malformed callback data" });
        }

        const externalReference = body.ExternalReference;
        const status = body.Status; // Typically "Success" or "Failed"
        const amountPaid = body.Amount;
        const mpesaReceiptNumber = body.MpesaReceiptNumber;
        const phonePaidFrom = body.PhoneNumber;
        
        let depositRecord = await PayheroDeposit.findOne({ reference: externalReference });

        if (status !== 'Success') {
            const desc = body.ResultDesc || "Failed/Cancelled";
            console.log(`PayHero STK Push failed or cancelled by user. Desc: ${desc}`);
            if (depositRecord) {
                depositRecord.status = 'failed';
                await depositRecord.save();
            }
            return res.json({ result: "Acknowledged cancellation/failure" });
        }

        // Successfully paid!
        if (depositRecord) {
            depositRecord.status = 'completed';
            depositRecord.receiptNumber = mpesaReceiptNumber;
            await depositRecord.save();
        } else {
             console.warn(`Webhook received for Reference ${externalReference} but no pending deposit found in DB.`);
        }

        console.log(`User ${userId} successfully paid ${amountPaid} via PayHero M-Pesa ${mpesaReceiptNumber}`);

        // 1. Give the user an actual Stellar/Local wallet equivalent!
        let wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            console.log(`Provisioning missing Stellar wallet for user ${userId} upon PayHero funding.`);
            const keypair = await stellarService.createWallet();
            wallet = await Wallet.create({
                user: userId,
                stellarPublicKey: keypair.publicKey,
                stellarSecretKey: keypair.secret,
                walletType: 'student', // Defaulting to student for this workflow
                balance: 0
            });
        }

        // 2. Perform the actual XLM transfer from Platform Admin to the User's Wallet
        if (stellarService.platformKey) {
            console.log(`Executing real Stellar transfer from Platform to User ${userId} for ${amountPaid} KES`);
            try {
                await stellarService.makePayment(
                    stellarService.platformKey.secret(),
                    wallet.stellarPublicKey,
                    amountPaid
                );
                console.log("Stellar payment successful. Network balance is now synchronized.");
            } catch (err) {
                console.error("Critical: Failed to sync PayHero deposit to Stellar network!", err);
            }
        } else {
             console.warn("PLATFORM_SECRET_KEY missing. Skipping Stellar network synchronization.");
        }

        // Increment the local database for immediate UI update before the next network pull
        wallet.balance += Number(amountPaid);
        await wallet.save();

        // Log the Transaction
        await Transaction.create({
            fromWallet: null, // "Platform/Mpesa"
            toWallet: wallet._id,
            amount: amountPaid,
            type: 'deposit',
            description: `PayHero M-Pesa Deposit from ${phonePaidFrom} (Receipt: ${mpesaReceiptNumber})`,
            status: 'completed'
        });

        res.json({ success: true, message: "Webhook processed" });
    } catch (e) {
        console.error("PayHero Callback processing error:", e);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// Check PayHero Transaction Status (for Polling)
const checkPayheroStatus = async (req, res) => {
    try {
        const { reference } = req.params;
        const deposit = await PayheroDeposit.findOne({ reference, user: req.user.id });
        
        if (!deposit) {
            return res.status(404).json({ message: "PayHero transaction not found" });
        }

        res.json({ status: deposit.status, amount: deposit.amount, receipt: deposit.receiptNumber });
    } catch (e) {
        console.error("Status check error:", e);
        res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = { payheroDeposit, payheroCallback, checkPayheroStatus };
