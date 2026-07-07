require('dotenv').config();
const Redis = require('ioredis');

let redisClient = null;
let redisEnabled = false;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // Mandatory for BullMQ to handle retries itself
      connectTimeout: 5000,       // 5 seconds connection timeout
      retryStrategy(times) {
        if (times > 3) {
          console.warn("[Redis Connection Manager] Max reconnect attempts reached. Redis will remain disabled.");
          redisEnabled = false;
          return null; // Stop reconnecting to fallback to in-memory mode
        }
        const delay = Math.min(times * 1000, 3000);
        return delay;
      }
    });

    redisClient.on('connect', () => {
      console.log(`[Redis Connection Manager] Connecting to Redis server at ${process.env.REDIS_URL}...`);
    });

    redisClient.on('ready', () => {
      console.log(`[Redis Connection Manager] Redis client is ready!`);
      redisEnabled = true;
    });

    redisClient.on('error', (err) => {
      console.error(`[Redis Connection Manager] Redis error:`, err.message);
      // We don't crash the server, we just let fallback logic run if ready status changes
    });

    redisClient.on('end', () => {
      console.warn(`[Redis Connection Manager] Redis connection ended.`);
      redisEnabled = false;
    });

  } catch (err) {
    console.error("[Redis Connection Manager] Initialization failed:", err);
    redisEnabled = false;
  }
} else {
  console.log("[Redis Connection Manager] REDIS_URL not configured. Running in Fallback mode.");
}

function getRedisClient() {
  return redisClient;
}

function isRedisEnabled() {
  return redisEnabled && redisClient && redisClient.status === 'ready';
}

module.exports = {
  getRedisClient,
  isRedisEnabled
};
