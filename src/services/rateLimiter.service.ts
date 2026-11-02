import { redisClient } from '../lib/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { RateLimitCheckResult } from '../types/index.js';

// Lua script for atomic sliding-window rate limiting
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clearBefore = now - windowMs

-- 1. Evict timestamps outside the sliding window
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)

-- 2. Count remaining timestamps in current window
local currentCount = redis.call('ZCARD', key)

if currentCount < limit then
  -- Add current timestamp (unique member by appending auto-incrementing sequence)
  local seq = redis.call('INCR', key .. ':seq')
  redis.call('ZADD', key, now, now .. '-' .. seq)
  -- Set TTL to ensure key cleanup if idle (window + 1 minute)
  redis.call('PEXPIRE', key, windowMs + 60000)
  redis.call('PEXPIRE', key .. ':seq', windowMs + 60000)
  return {1, currentCount + 1, 0}
else
  -- Quota exceeded: fetch the earliest timestamp in the current window to determine retry delay
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = 1000
  if #oldest >= 2 then
    local oldestTimestamp = tonumber(oldest[2])
    retryAfterMs = math.max(100, (oldestTimestamp + windowMs) - now)
  end
  return {0, currentCount, math.ceil(retryAfterMs / 1000)}
end
`;

export class RateLimiterService {
  /**
   * Evaluates if a sender can dispatch an email under their sliding-window limit (default: 200 emails / 3600s).
   */
  public static async checkAndConsume(
    senderId: string,
    hourlyQuota: number = env.DEFAULT_HOURLY_LIMIT
  ): Promise<RateLimitCheckResult> {
    const key = `ratelimit:sender:${senderId}`;
    const now = Date.now();
    const windowMs = 3600 * 1000; // 1 hour sliding window

    try {
      // Evaluate atomic Lua script
      const result = (await redisClient.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        now.toString(),
        windowMs.toString(),
        hourlyQuota.toString()
      )) as [number, number, number];

      const allowed = result[0] === 1;
      const currentCount = result[1];
      const retryAfterSeconds = result[2];

      if (!allowed) {
        logger.warn(
          { senderId, currentCount, hourlyQuota, retryAfterSeconds },
          'Sender hourly rate limit reached'
        );
      }

      return {
        allowed,
        currentCount,
        limit: hourlyQuota,
        retryAfterSeconds: allowed ? undefined : retryAfterSeconds,
      };
    } catch (err) {
      logger.error({ err, senderId }, 'Error evaluating Redis sliding-window rate limit');
      // In case of Redis script error, allow to prevent halting the queue entirely
      return { allowed: true, currentCount: 0, limit: hourlyQuota };
    }
  }

  /**
   * Enforces provider-safe inter-message delay (e.g. minimum 2 seconds between emails from the same sender).
   * Returns delay in milliseconds that worker must wait (0 if safe to send immediately).
   */
  public static async checkSenderThrottle(
    senderId: string,
    minDelayMs: number = env.DEFAULT_MIN_DELAY_MS
  ): Promise<number> {
    const key = `throttle:sender:${senderId}:last_sent`;
    const now = Date.now();

    try {
      const lastSentStr = await redisClient.get(key);
      if (lastSentStr) {
        const lastSent = parseInt(lastSentStr, 10);
        const elapsed = now - lastSent;
        if (elapsed < minDelayMs) {
          return minDelayMs - elapsed;
        }
      }

      // Mark the current send timestamp
      await redisClient.set(key, now.toString(), 'PX', minDelayMs * 2);
      return 0;
    } catch (err) {
      logger.error({ err, senderId }, 'Error checking sender throttle');
      return 0;
    }
  }

  /**
   * Resets rate limit keys for testing and benchmarks.
   */
  public static async resetSenderRateLimit(senderId: string): Promise<void> {
    await redisClient.del(`ratelimit:sender:${senderId}`);
    await redisClient.del(`ratelimit:sender:${senderId}:seq`);
    await redisClient.del(`throttle:sender:${senderId}:last_sent`);
  }
}
