const NodeCache = require("node-cache");
const { getRedisClient, isRedisEnabled } = require("../config/redis");

// Initialize memory cache fallback (stdTTL of 5 minutes)
const memoryCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

/**
 * Get a cached value by key
 */
async function get(key) {
  try {
    if (isRedisEnabled()) {
      const client = getRedisClient();
      const cachedVal = await client.get(key);
      if (cachedVal) {
        return JSON.parse(cachedVal);
      }
      return null;
    }
  } catch (err) {
    console.error(`[Cache Service] Redis get error for key "${key}":`, err.message);
  }

  // Fallback to memory cache
  return memoryCache.get(key);
}

/**
 * Set a cached value with TTL (in seconds)
 */
async function set(key, value, ttlSeconds = 300) {
  try {
    if (isRedisEnabled()) {
      const client = getRedisClient();
      const stringified = JSON.stringify(value);
      await client.set(key, stringified, "EX", ttlSeconds);
      return true;
    }
  } catch (err) {
    console.error(`[Cache Service] Redis set error for key "${key}":`, err.message);
  }

  // Fallback to memory cache
  return memoryCache.set(key, value, ttlSeconds);
}

/**
 * Delete a cached value by key
 */
async function del(key) {
  try {
    if (isRedisEnabled()) {
      const client = getRedisClient();
      await client.del(key);
      return true;
    }
  } catch (err) {
    console.error(`[Cache Service] Redis delete error for key "${key}":`, err.message);
  }

  // Fallback to memory cache
  return memoryCache.del(key);
}

/**
 * Delete keys matching a pattern (e.g., 'meals:*')
 */
async function delPattern(pattern) {
  try {
    if (isRedisEnabled()) {
      const client = getRedisClient();
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
      }
      return true;
    }
  } catch (err) {
    console.error(`[Cache Service] Redis delPattern error for pattern "${pattern}":`, err.message);
  }

  // Node-cache pattern matching:
  const keys = memoryCache.keys();
  const regexStr = "^" + pattern.replace(/\*/g, ".*") + "$";
  const regex = new RegExp(regexStr);
  const matchingKeys = keys.filter(key => regex.test(key));
  if (matchingKeys.length > 0) {
    memoryCache.del(matchingKeys);
  }
  return true;
}

/**
 * Clear the entire cache
 */
async function flush() {
  try {
    if (isRedisEnabled()) {
      const client = getRedisClient();
      await client.flushall();
      return true;
    }
  } catch (err) {
    console.error("[Cache Service] Redis flush error:", err.message);
  }

  memoryCache.flushAll();
  return true;
}

module.exports = {
  get,
  set,
  del,
  delPattern,
  flush
};
