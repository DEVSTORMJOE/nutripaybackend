const axios = require('axios');
require('dotenv').config();

// Retrieve Token for Safaricom
const getSafaricomToken = async () => {
    const consumer_key = process.env.DARAJA_CONSUMER_KEY;
    const consumer_secret = process.env.DARAJA_CONSUMER_SECRET;
    
    if (!consumer_key || !consumer_secret) {
        console.warn("Daraja consumer key or secret is missing. Mocking M-Pesa token.");
        return "mocked_token";
    }

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

/**
 * Initiate an STK Push deposit
 */
async function initiateDeposit(userId, phone, amountKes) {
    const token = await getSafaricomToken();
    if (!token) {
        throw new Error("Failed to generate Safaricom Auth Token");
    }

    const shortcode = process.env.DARAJA_SHORTCODE || "174379";
    const passkey = process.env.DARAJA_PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, -3);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const callbackUrl = process.env.DARAJA_CALLBACK_URL || "https://mydomain.com/api/mpesa/callback";

    const stkData = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Number(amountKes),
        PartyA: phone,       
        PartyB: shortcode,   
        PhoneNumber: phone,  
        CallBackURL: `${callbackUrl}/${userId}`, 
        AccountReference: "NutriPay Deposit",
        TransactionDesc: "Wallet Funding"
    };

    if (token === "mocked_token") {
        console.log("[M-Pesa STK Mock] Initiating STK Push for user:", userId, "amount:", amountKes);
        return {
            CheckoutRequestID: `ws_CO_Mock_${crypto.randomBytes(8).toString('hex')}`,
            ResponseCode: "0",
            CustomerMessage: "Success. Request accepted for processing"
        };
    }

    const response = await axios.post(
        "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        stkData,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    return response.data;
}

/**
 * Verify webhook callback data
 */
function verifyCallback(body) {
    if (!body || !body.Body || !body.Body.stkCallback) {
        throw new Error("Invalid M-Pesa callback body");
    }

    const callbackData = body.Body.stkCallback;
    const checkoutRequestID = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    if (resultCode !== 0) {
        return {
            success: false,
            checkoutRequestID,
            resultCode,
            message: callbackData.ResultDesc || "Failed or cancelled"
        };
    }

    const meta = callbackData.CallbackMetadata.Item;
    const amountPaid = meta.find(i => i.Name === "Amount").Value;
    const mpesaReceiptNumber = meta.find(i => i.Name === "MpesaReceiptNumber").Value;
    const phonePaidFrom = meta.find(i => i.Name === "PhoneNumber").Value;

    return {
        success: true,
        checkoutRequestID,
        resultCode,
        amountPaid,
        mpesaReceiptNumber,
        phonePaidFrom
    };
}

/**
 * Mock M-Pesa B2C withdrawal
 */
async function withdrawToMpesa(phone, amountKes) {
    console.log(`[M-Pesa B2C Payout] Dispatched ${amountKes} KES to ${phone}.`);
    // Sandbox or mock payout succeeds instantly
    return {
        success: true,
        conversationId: `B2C_Conv_${Math.random().toString(36).substring(7)}`,
        originatorConversationId: `B2C_Orig_${Math.random().toString(36).substring(7)}`,
        responseDescription: "Accept the service request successfully."
    };
}

module.exports = {
    initiateDeposit,
    verifyCallback,
    withdrawToMpesa
};
