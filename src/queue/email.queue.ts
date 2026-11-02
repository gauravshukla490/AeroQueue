import { Queue } from 'bullmq';
import { redisConfig } from '../lib/redis.js';
import { EmailJobPayload } from '../types/index.js';
import { logger } from '../config/logger.js';

export const EMAIL_QUEUE_NAME = 'email-dispatch-queue';
export const EMAIL_DLQ_NAME = 'email-dead-letter-queue';

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      count: 1000,
      age: 24 * 3600, // keep 24 hours
    },
    removeOnFail: {
      count: 5000,
      age: 7 * 24 * 3600, // keep failed jobs for 7 days
    },
  },
});

export const emailDLQ = new Queue<EmailJobPayload & { reason: string }>(EMAIL_DLQ_NAME, {
  connection: redisConfig,
});

/**
 * Schedules an email dispatch job in BullMQ with calculated delay.
 */
export async function scheduleEmailJob(
  payload: EmailJobPayload,
  scheduledAt: Date
): Promise<string> {
  const now = Date.now();
  const targetTime = scheduledAt.getTime();
  const delayMs = Math.max(0, targetTime - now);

  const job = await emailQueue.add('dispatch-email', payload, {
    jobId: payload.emailJobId,
    delay: delayMs,
  });

  logger.info(
    { jobId: job.id, delayMs, recipient: payload.recipient, scheduledAt },
    'Email job enqueued in BullMQ'
  );

  return job.id!;
}
