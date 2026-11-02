import { RateLimiterService } from '../services/rateLimiter.service.js';
import { logger } from '../config/logger.js';
import { randomUUID } from 'crypto';

async function testSlidingWindowRateLimiter() {
  const testSenderId = `test-sender-${randomUUID().slice(0, 8)}`;
  const quota = 10; // Test with small quota of 10 for rapid verification

  logger.info({ testSenderId, quota }, '🧪 Starting Sliding-Window Rate Limiter Test...');

  // Reset keys
  await RateLimiterService.resetSenderRateLimit(testSenderId);

  let allowedCount = 0;
  let rejectedCount = 0;

  // Fire 15 consecutive requests
  for (let i = 1; i <= 15; i++) {
    const result = await RateLimiterService.checkAndConsume(testSenderId, quota);
    if (result.allowed) {
      allowedCount++;
      logger.info(`Request ${i}: ALLOWED (Current in window: ${result.currentCount}/${quota})`);
    } else {
      rejectedCount++;
      logger.warn(
        `Request ${i}: BLOCKED (Current in window: ${result.currentCount}/${quota}, Retry after: ${result.retryAfterSeconds}s)`
      );
    }
  }

  logger.info({ allowedCount, rejectedCount }, 'Test results');

  if (allowedCount === quota && rejectedCount === 5) {
    logger.info('🎉 Rate Limiter Test PASSED! Exactly 10 allowed and 5 blocked.');
  } else {
    logger.error('❌ Rate Limiter Test FAILED! Counts do not match expected quota.');
  }

  process.exit(0);
}

testSlidingWindowRateLimiter().catch((err) => {
  logger.error({ err }, 'Test error');
  process.exit(1);
});
