const axios = require('axios');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const MpesaDeposit = require('../models/MpesaDeposit');
const stellarService = require('../services/stellarService');

// Retrieve Token for Safaricom
const getSafaricomToken = async () => {
    const consumer_key = process.env.DARAJA_CONSUMER_KEY;
    const consumer_secret = process.env.DARAJA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");

    try {
        const response = await axios.get(
            `https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    authorization: `Basic ${auth}`,
                },
            }
        );
        return response.data.access_token;
    } catch (err) {
        console.error("Token generation failed:", err.message);
        return null;
    }
};

// Start M-Pesa STK Push
const mpesaDeposit = async (req, res) => {
    try {
        const { phone, amountKes } = req.body;
        
        if (!phone || !amountKes || amountKes <= 0) {
            return res.status(400).json({ message: "Valid Phone number (254...) and KES amount required" });
        }

        const token = await getSafaricomToken();
        if (!token) {
            return res.status(500).json({ message: "Failed to generate Safaricom Auth Token" });
        }

        const shortcode = process.env.DARAJA_SHORTCODE;
        const passkey = process.env.DARAJA_PASSKEY;
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, -3);
        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

        // The webhook URL should hit your live ngrok/server
        const callbackUrl = process.env.DARAJA_CALLBACK_URL || "https://mydomain.com/api/mpesa/callback";

        const stkData = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline", // Used for paybill, CustomerBuyGoodsOnline for Till
            Amount: amountKes,
            PartyA: phone,       // Must be in format 2547XXXXXXXX
            PartyB: shortcode,   
            PhoneNumber: phone,  
            CallBackURL: `${callbackUrl}/${req.user.id}`, // passing user id so webhook knows whose wallet to fund
            AccountReference: "NutriPay Deposit",
            TransactionDesc: "Wallet Funding"
        };

        const response = await axios.post(
            "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
            stkData,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        // Save the pending transaction with the CheckoutRequestID
        const checkoutRequestID = response.data.CheckoutRequestID;
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
        if (error.response) console.error(error.response.data);
        res.status(500).json({ message: 'M-Pesa request failed' });
    }
};

// Safaricom Webhook Callback Handler
const mpesaCallback = async (req, res) => {
    try {
        console.log("M-Pesa Callback Received:", JSON.stringify(req.body, null, 2));
        const userId = req.params.userId;

        const body = req.body.Body.stkCallback;
        const checkoutRequestID = body.CheckoutRequestID;
        
        let depositRecord = await MpesaDeposit.findOne({ checkoutRequestID });

        if (body.ResultCode !== 0) {
            console.log(`STK Push failed or cancelled by user. Code: ${body.ResultCode}, Desc: ${body.ResultDesc}`);
            if (depositRecord) {
                depositRecord.status = body.ResultCode === 1032 ? 'cancelled' : 'failed';
                await depositRecord.save();
            }
            return res.json({ result: "Acknowledged cancellation/failure" });
        }

        // Successfully paid!
        const meta = body.CallbackMetadata.Item;
        const amountPaid = meta.find(i => i.Name === "Amount").Value;
        const mpesaReceiptNumber = meta.find(i => i.Name === "MpesaReceiptNumber").Value;
        const phonePaidFrom = meta.find(i => i.Name === "PhoneNumber").Value;

        if (depositRecord) {
            depositRecord.status = 'completed';
            depositRecord.receiptNumber = mpesaReceiptNumber;
            await depositRecord.save();
        } else {
             console.warn(`Webhook received for CheckoutRequestID ${checkoutRequestID} but no pending deposit found in DB.`);
        }

        console.log(`User ${userId} successfully paid ${amountPaid} via M-Pesa ${mpesaReceiptNumber}`);

        // 1. Give the user an actual Stellar/Local wallet equivalent!
        let wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            console.log(`Provisioning missing Stellar wallet for user ${userId} upon M-pesa funding.`);
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
                console.error("Critical: Failed to sync M-Pesa deposit to Stellar network!", err);
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
            description: `M-Pesa Deposit from ${phonePaidFrom} (Receipt: ${mpesaReceiptNumber})`,
            status: 'completed'
        });

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

module.exports = { mpesaDeposit, mpesaCallback, checkMpesaStatus };
