// middleware/rateLimiters.js
const rateLimit = require("express-rate-limit");
const { getRedisClient, isRedisEnabled } = require("../config/redis");

// A runtime proxy store that delegates dynamically to RedisStore or MemoryStore
class DynamicRateLimitStore {
  constructor(name) {
    this.name = name;
    this.memoryStore = new rateLimit.MemoryStore();
    this.redisStore = null;
    this.options = null;
  }

  init(options) {
    this.options = options;
    if (this.memoryStore && typeof this.memoryStore.init === "function") {
      this.memoryStore.init(options);
    }
    // If Redis is already active at startup, initialize it immediately
    if (isRedisEnabled()) {
      this.getStore();
    }
  }

  getStore() {
    if (isRedisEnabled()) {
      if (!this.redisStore) {
        try {
          // Destructure RedisStore correctly from rate-limit-redis
          const { RedisStore } = require("rate-limit-redis");
          const storeInstance = new RedisStore({
            prefix: `rl:${this.name}:`,
            sendCommand: async (...args) => {
              const client = getRedisClient();
              return client.call(...args);
            }
          });

          // Call init to supply windowMs and load SHA scripts
          if (this.options) {
            storeInstance.init(this.options).catch(err => {
              console.error(`[Rate Limiter: ${this.name}] Failed to async init RedisStore:`, err.message);
            });
          }

          this.redisStore = storeInstance;
          console.log(`[Rate Limiter: ${this.name}] Dynamically switched store to RedisStore.`);
        } catch (err) {
          console.error(`[Rate Limiter: ${this.name}] Failed to initialize RedisStore. Using MemoryStore:`, err.message);
          return this.memoryStore;
        }
      }
      return this.redisStore;
    }
    // If Redis is disabled/closed, ensure we fallback to memory store
    if (this.redisStore) {
      this.redisStore = null;
      console.log(`[Rate Limiter: ${this.name}] Dynamically switched store to MemoryStore.`);
    }
    return this.memoryStore;
  }

  async increment(key) {
    return this.getStore().increment(key);
  }

  async decrement(key) {
    return this.getStore().decrement(key);
  }

  async resetKey(key) {
    return this.getStore().resetKey(key);
  }
}

// 1. Authentication Limiter: Strict limit of 5 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    message: "Too many authentication attempts from this IP. Please try again after 15 minutes."
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: new DynamicRateLimitStore("auth")
});

// 2. Transaction/Financial Limiter: 15 requests per 15 minutes per IP
const transactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: {
    message: "Too many transaction attempts from this IP. Please try again after 15 minutes to protect your account."
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: new DynamicRateLimitStore("transaction")
});

// 3. AI Assistant Limiter: 15 prompts per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  message: {
    message: "Too many queries to the AI Assistant. Please slow down and try again shortly."
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: new DynamicRateLimitStore("ai")
});

// 4. General API Limiter: 150 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150,
  message: {
    message: "Too many requests from this IP. Please try again after 15 minutes."
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: new DynamicRateLimitStore("general")
});

module.exports = {
  authLimiter,
  transactionLimiter,
  aiLimiter,
  generalLimiter
};
