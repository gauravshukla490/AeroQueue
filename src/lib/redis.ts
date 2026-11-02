import { Redis, RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const redisConfig: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    logger.warn({ attempt: times, delay }, 'Reconnecting to Redis...');
    return delay;
  },
};

export const redisClient = new Redis(redisConfig);

redisClient.on('connect', () => {
  logger.info('Connected to Redis');
});

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});
