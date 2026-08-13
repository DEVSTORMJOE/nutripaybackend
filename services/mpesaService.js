const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const isProductionEnv = () => {
    return process.env.DARAJA_ENV === 'production' || (process.env.NODE_ENV === 'production' && process.env.DARAJA_ENV !== 'sandbox');
};

const getBaseUrl = () => {
    return isProductionEnv() ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
};

/**
 * Format timestamp as 14-digit YYYYMMDDHHmmss for Daraja API
 */
function getDarajaTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
        now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds())
    );
}

// Retrieve Token for Safaricom
const getSafaricomToken = async () => {
    const consumer_key = process.env.DARAJA_CONSUMER_KEY;
    const consumer_secret = process.env.DARAJA_CONSUMER_SECRET;
    
    if (!consumer_key || !consumer_secret) {
        console.warn("Daraja consumer key or secret is missing.");
        if (!isProductionEnv()) {
            return "mocked_token";
        }
        throw new Error("Missing DARAJA_CONSUMER_KEY or DARAJA_CONSUMER_SECRET in environment configuration");
    }

    const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");
    const baseUrl = getBaseUrl();

    try {
        const response = await axios.get(
            `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    authorization: `Basic ${auth}`,
                },
                timeout: 10000
            }
        );
        return response.data.access_token;
    } catch (err) {
        console.error("Daraja token generation failed:", err.response?.data || err.message);
        if (!isProductionEnv()) {
            return "mocked_token";
        }
        return null;
    }
};

/**
 * Initiate an STK Push deposit
 */
async function initiateDeposit(userId, phone, amountKes, orderType = 'monthly_subscription') {
    const token = await getSafaricomToken();
    if (!token) {
        throw new Error("Failed to generate Safaricom Auth Token");
    }

    const { normalizePhone } = require('../utils/phoneUtils');
    const formattedPhone = normalizePhone(phone);

    const shortcode = process.env.DARAJA_SHORTCODE || "174379";
    const passkey = process.env.DARAJA_PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
    const timestamp = getDarajaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    
    let callbackUrl = process.env.DARAJA_CALLBACK_URL || "https://api.nutripay.co.ke/api/mpesa/callback";
    callbackUrl = callbackUrl.replace(/\/+$/, '');

    const reference = orderType === 'quick_order' ? "NutriOrder" : "NutriPay";
    const desc = orderType === 'quick_order' ? "QuickOrder" : "Subscription";
    const transactionType = process.env.DARAJA_TRANSACTION_TYPE || "CustomerPayBillOnline";
    const partyB = process.env.DARAJA_PARTY_B || shortcode;

    const stkData = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: Math.round(Number(amountKes)),
        PartyA: formattedPhone,       
        PartyB: partyB,   
        PhoneNumber: formattedPhone,  
        CallBackURL: `${callbackUrl}/${userId}`, 
        AccountReference: reference,
        TransactionDesc: desc
    };

    if (token === "mocked_token") {
        console.log("[M-Pesa STK Mock] Initiating STK Push for user:", userId, "amount:", amountKes);
        return {
            CheckoutRequestID: `ws_CO_Mock_${crypto.randomBytes(8).toString('hex')}`,
            ResponseCode: "0",
            CustomerMessage: "Success. Request accepted for processing"
        };
    }

    const baseUrl = getBaseUrl();
    const response = await axios.post(
        `${baseUrl}/mpesa/stkpush/v1/processrequest`,
        stkData,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            timeout: 15000
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

    const meta = callbackData.CallbackMetadata?.Item || [];
    const getMetaVal = (name) => meta.find(i => i.Name === name)?.Value;

    const amountPaid = getMetaVal("Amount");
    const mpesaReceiptNumber = getMetaVal("MpesaReceiptNumber");
    const phonePaidFrom = getMetaVal("PhoneNumber");

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
 * M-Pesa B2C withdrawal payout
 */
async function withdrawToMpesa(phone, amountKes) {
    const { normalizePhone } = require('../utils/phoneUtils');
    const formattedPhone = normalizePhone(phone);
    const initiatorName = process.env.DARAJA_INITIATOR_NAME;
    const securityCredential = process.env.DARAJA_SECURITY_CREDENTIAL;

    if (!initiatorName || !securityCredential) {
        console.log(`[M-Pesa B2C Payout] Initiator/Security credential missing or sandbox mode. Dispatched ${amountKes} KES to ${formattedPhone} (Mock Mode).`);
        return {
            success: true,
            conversationId: `B2C_Conv_${crypto.randomBytes(6).toString('hex')}`,
            originatorConversationId: `B2C_Orig_${crypto.randomBytes(6).toString('hex')}`,
            responseDescription: "Accept the service request successfully."
        };
    }

    const token = await getSafaricomToken();
    if (!token) {
        throw new Error("Failed to generate Safaricom Auth Token for B2C withdrawal");
    }

    let callbackUrl = process.env.DARAJA_CALLBACK_URL || "https://api.nutripay.co.ke/api/mpesa/callback";
    const baseUrl = getBaseUrl();
    const cleanCallbackUrl = callbackUrl.replace(/\/callback.*$/, '');

    const b2cData = {
        InitiatorName: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: process.env.DARAJA_B2C_COMMAND_ID || "BusinessPayment",
        Amount: Math.round(Number(amountKes)),
        PartyA: process.env.DARAJA_B2C_SHORTCODE || process.env.DARAJA_SHORTCODE,
        PartyB: formattedPhone,
        Remarks: "NutriPay Withdrawal",
        QueueTimeOutURL: process.env.DARAJA_B2C_TIMEOUT_URL || `${cleanCallbackUrl}/b2c-callback`,
        ResultURL: process.env.DARAJA_B2C_RESULT_URL || `${cleanCallbackUrl}/b2c-callback`,
        Occasion: "Withdrawal"
    };

    const response = await axios.post(
        `${baseUrl}/mpesa/b2c/v1/paymentrequest`,
        b2cData,
        {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 20000
        }
    );

    return {
        success: response.data.ResponseCode === "0",
        conversationId: response.data.ConversationID,
        originatorConversationId: response.data.OriginatorConversationID,
        responseDescription: response.data.ResponseDescription
    };
}

module.exports = {
    initiateDeposit,
    verifyCallback,
    withdrawToMpesa
};

