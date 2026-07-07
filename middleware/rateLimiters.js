// middleware/rateLimiters.js
const rateLimit = require("express-rate-limit");

// 1. Authentication Limiter: Strict limit of 5 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    message: "Too many authentication attempts from this IP. Please try again after 15 minutes."
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 2. Transaction/Financial Limiter: 15 requests per 15 minutes per IP
const transactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: {
    message: "Too many transaction attempts from this IP. Please try again after 15 minutes to protect your account."
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 3. AI Assistant Limiter: 15 prompts per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  message: {
    message: "Too many queries to the AI Assistant. Please slow down and try again shortly."
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 4. General API Limiter: 150 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150,
  message: {
    message: "Too many requests from this IP. Please try again after 15 minutes."
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  authLimiter,
  transactionLimiter,
  aiLimiter,
  generalLimiter
};
