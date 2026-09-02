const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const isProductionEnv = () => {
  return process.env.NODE_ENV === 'production' || process.env.PAYHERO_ENV === 'production';
};

const getPayHeroApiUrl = () => {
  return process.env.PAYHERO_API_URL || 'https://backend.payhero.co.ke/api/v2/payments';
};

/**
 * Initiate an STK Push deposit via PayHero Kenya
 */
async function initiateDeposit(userId, phone, amountKes, orderType = 'monthly_subscription') {
  const { normalizePhone } = require('../utils/phoneUtils');
  const formattedPhone = normalizePhone(phone);

  const apiKey = process.env.PAYHERO_API_KEY || process.env.API_USERNAME;
  const apiSecret = process.env.PAYHERO_API_SECRET || process.env.API_PASSWORD;
  const channelId = process.env.PAYHERO_CHANNEL_ID;

  let callbackUrl = process.env.PAYHERO_CALLBACK_URL || process.env.DARAJA_CALLBACK_URL || "https://api.nutripay.co.ke/api/payhero/callback";
  callbackUrl = callbackUrl.replace(/\/+$/, '');

  const reference = `${orderType}_${userId}_${Date.now()}`;
  const amount = Math.round(Number(amountKes));

  if (!apiKey || !channelId) {
    throw new Error("PayHero API credentials (PAYHERO_API_KEY / PAYHERO_CHANNEL_ID) are missing from configuration.");
  }

  const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret || ''}`).toString('base64')}`;

  const payload = {
    amount: amount,
    phone_number: formattedPhone,
    channel_id: Number(channelId),
    provider: "m-pesa",
    external_reference: reference,
    callback_url: `${callbackUrl}/${userId}`
  };

  const maxRetries = 2;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[PayHero STK Push] Retrying initiation (Attempt ${attempt} of ${maxRetries + 1})...`);
      }

      const response = await axios.post(
        getPayHeroApiUrl(),
        payload,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          timeout: 35000
        }
      );

      return {
        success: response.data.status === 'SUCCESS' || response.data.success === true || response.data.code === 200,
        provider: "payhero",
        CheckoutRequestID: response.data.checkout_id || response.data.CheckoutRequestID || response.data.MerchantRequestID || response.data.reference || `PH_${crypto.randomBytes(6).toString('hex')}`,
        reference,
        ResponseCode: "0",
        CustomerMessage: response.data.message || "PayHero STK Push initiated successfully",
        raw: response.data
      };
    } catch (err) {
      lastError = err;
      const statusCode = err.response?.status;
      console.warn(`[PayHero STK Push] Attempt ${attempt} failed (Status: ${statusCode || 'Network error'}):`, err.response?.data || err.message);

      // Do not retry 4xx errors (e.g. 400 Bad Request or 401 Unauthorized), except rate limit 429
      if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        break;
      }

      if (attempt <= maxRetries) {
        console.log(`[PayHero STK Push] Waiting 1.5s before retry ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  console.error("PayHero STK Push initiation failed after retries:", lastError?.response?.data || lastError?.message);
  const errorObj = new Error(`PayHero STK Push failed: ${lastError?.response?.data?.message || lastError?.response?.data?.error_message || lastError?.message}`);
  errorObj.statusCode = lastError?.response?.status;
  errorObj.isGatewayError = !!lastError?.response;
  throw errorObj;
}

/**
 * Query PayHero API for payment status by external reference
 */
async function checkTransactionStatus(reference) {
  if (!reference) return null;

  const apiKey = process.env.PAYHERO_API_KEY || process.env.API_USERNAME;
  const apiSecret = process.env.PAYHERO_API_SECRET || process.env.API_PASSWORD;

  if (!apiKey) return null;

  const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret || ''}`).toString('base64')}`;

  try {
    const url = `${getPayHeroApiUrl()}?external_reference=${encodeURIComponent(reference)}`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;
    const transactions = Array.isArray(data) ? data : (data?.response || data?.results || data?.data || [data]);
    
    if (!transactions || transactions.length === 0) {
      return null;
    }

    // Find matching transaction
    const tx = transactions.find(t => 
      t.external_reference === reference || 
      t.ExternalReference === reference ||
      t.checkout_id === reference ||
      t.CheckoutRequestID === reference
    ) || transactions[0];

    const rawStatus = String(tx.Status || tx.status || tx.ResultDesc || '').toUpperCase();
    const resultCode = tx.ResultCode !== undefined ? tx.ResultCode : (tx.result_code !== undefined ? tx.result_code : null);
    
    const isSuccess = rawStatus.includes('SUCCESS') || rawStatus.includes('COMPLETED') || tx.success === true || resultCode === 0 || resultCode === '0';
    const isFailed = rawStatus.includes('FAIL') || rawStatus.includes('CANCEL') || resultCode === 1032 || resultCode === 1;

    return {
      found: true,
      success: isSuccess,
      failed: isFailed,
      receiptNumber: tx.MpesaReceiptNumber || tx.mpesa_code || tx.receipt || '',
      amount: Number(tx.Amount || tx.amount || 0),
      phone: tx.Phone || tx.phone_number || tx.phone || '',
      raw: tx
    };
  } catch (err) {
    console.warn(`[PayHero Status Check] Error checking status for reference ${reference}:`, err.message);
    return null;
  }
}

/**
 * Verify PayHero webhook callback data
 */
function verifyCallback(body) {
  if (!body) {
    throw new Error("Invalid PayHero callback body");
  }

  // PayHero callback payload can arrive directly or inside response/response_data wrapper
  const payload = body.response || body.response_data || body;

  const rawStatus = String(payload.Status || payload.status || payload.ResultDesc || '').toUpperCase();
  const resultCode = payload.ResultCode !== undefined ? payload.ResultCode : (payload.result_code !== undefined ? payload.result_code : (payload.code !== undefined ? payload.code : null));
  
  const isSuccess =
    rawStatus.includes('SUCCESS') ||
    rawStatus.includes('COMPLETED') ||
    payload.success === true ||
    resultCode === 0 ||
    resultCode === '0';

  const checkoutRequestID =
    payload.CheckoutRequestID ||
    payload.checkout_id ||
    payload.reference ||
    `PH_CB_${crypto.randomBytes(4).toString('hex')}`;

  const merchantRequestID = payload.MerchantRequestID || payload.merchant_reference || '';

  const externalReference =
    payload.ExternalReference ||
    payload.external_reference ||
    payload.externalReference ||
    payload.merchant_reference ||
    '';

  const amountPaid = Number(payload.Amount || payload.amount || 0);

  const mpesaReceiptNumber =
    payload.MpesaReceiptNumber ||
    payload.mpesa_code ||
    payload.receipt ||
    `PH${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const phonePaidFrom =
    payload.Phone ||
    payload.phone_number ||
    payload.PhoneNumber ||
    payload.phone ||
    '';

  if (!isSuccess) {
    return {
      success: false,
      provider: "payhero",
      checkoutRequestID,
      merchantRequestID,
      externalReference,
      resultCode: resultCode !== null ? resultCode : 1,
      message: payload.ResultDesc || payload.message || "PayHero transaction failed or cancelled"
    };
  }

  return {
    success: true,
    provider: "payhero",
    checkoutRequestID,
    merchantRequestID,
    externalReference,
    resultCode: 0,
    amountPaid,
    mpesaReceiptNumber,
    phonePaidFrom
  };
}

module.exports = {
  initiateDeposit,
  verifyCallback,
  checkTransactionStatus
};
