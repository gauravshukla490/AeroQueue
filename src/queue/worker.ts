import { Worker, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { redisConfig } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { EMAIL_QUEUE_NAME } from './email.queue.js';
import { EmailJobPayload } from '../types/index.js';
import { RateLimiterService } from '../services/rateLimiter.service.js';
import { DeliveryService } from '../services/delivery.service.js';
import { RecoveryService } from '../services/recovery.service.js';
import { EmailJobStatus } from '@prisma/client';

const workerInstanceId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

export async function processEmailJob(job: Job<EmailJobPayload>) {
  const { emailJobId, senderId, senderEmail, recipient, subject, body } = job.data;
  const log = logger.child({ jobId: job.id, emailJobId, worker: workerInstanceId });

  log.info({ recipient }, 'Worker picked up job');

  // 1. Transactional Row Lock and Send Lease Acquisition
  const acquiredJob = await prisma.$transaction(async (tx) => {
    // Acquire row-level lock using raw query with FOR UPDATE SKIP LOCKED
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: EmailJobStatus;
        attempts: number;
        max_attempts: number;
        lease_expires_at: Date | null;
      }>
    >`
      SELECT id, status, attempts, "maxAttempts" as max_attempts, "leaseExpiresAt" as lease_expires_at
      FROM email_jobs
      WHERE id = ${emailJobId}
      FOR UPDATE SKIP LOCKED
    `;

    if (!rows || rows.length === 0) {
      log.warn('Could not acquire lock on email_job row (may already be in process or deleted)');
      return null;
    }

    const currentRecord = rows[0];

    // Idempotency check: if already completed, do not send again
    if (currentRecord.status === EmailJobStatus.SENT) {
      log.info('Job is already marked SENT. Skipping delivery to preserve idempotency.');
      return 'ALREADY_SENT';
    }

    if (currentRecord.status === EmailJobStatus.CANCELLED) {
      log.info('Job is marked CANCELLED. Skipping delivery.');
      return 'CANCELLED';
    }

    // Set 60-second send lease
    const leaseExpiresAt = new Date(Date.now() + env.LEASE_DURATION_SECONDS * 1000);

    const updated = await tx.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: EmailJobStatus.PROCESSING,
        workerId: workerInstanceId,
        leaseExpiresAt,
        attempts: { increment: 1 },
      },
      include: { sender: true },
    });

    return updated;
  });

  if (!acquiredJob || acquiredJob === 'ALREADY_SENT' || acquiredJob === 'CANCELLED') {
    return;
  }

  // 2. Controlled Throughput: Sliding-Window Rate Limit Check (200 emails / hr per sender)
  const rateLimitResult = await RateLimiterService.checkAndConsume(
    senderId,
    acquiredJob.sender.hourlyQuota || env.DEFAULT_HOURLY_LIMIT
  );

  if (!rateLimitResult.allowed) {
    const delaySeconds = rateLimitResult.retryAfterSeconds || 60;
    log.warn(
      { delaySeconds, currentCount: rateLimitResult.currentCount },
      'Sender rate limit exceeded. Delaying job...'
    );

    // Reset status back to QUEUED
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: EmailJobStatus.QUEUED,
        leaseExpiresAt: null,
        workerId: null,
      },
    });

    // Re-schedule with delay
    await job.moveToDelayed(Date.now() + delaySeconds * 1000, job.token);
    return;
  }

  // 3. Provider-Safe Minimum Inter-Send Delay (2-second minimum spacing per sender)
  const throttleWaitMs = await RateLimiterService.checkSenderThrottle(
    senderId,
    acquiredJob.sender.minDelayMs || env.DEFAULT_MIN_DELAY_MS
  );

  if (throttleWaitMs > 0) {
    log.debug({ throttleWaitMs }, 'Waiting for inter-send throttle spacing');
    await new Promise((resolve) => setTimeout(resolve, throttleWaitMs));
  }

  // 4. Background Lease Heartbeat (extends lease every 20s during dispatch)
  const heartbeatInterval = setInterval(async () => {
    try {
      const newExpiry = new Date(Date.now() + env.LEASE_DURATION_SECONDS * 1000);
      await prisma.emailJob.updateMany({
        where: { id: emailJobId, workerId: workerInstanceId, status: EmailJobStatus.PROCESSING },
        data: { leaseExpiresAt: newExpiry },
      });
      log.debug('Heartbeat: extended send lease by 60s');
    } catch (err) {
      log.error({ err }, 'Failed to refresh lease heartbeat');
    }
  }, env.LEASE_HEARTBEAT_SECONDS * 1000);

  try {
    // 5. Send Email via SMTP
    const sendResult = await DeliveryService.sendMail({
      emailJobId,
      senderId,
      senderEmail,
      recipient,
      subject,
      body,
    });

    // 6. Complete Job in PostgreSQL & Elasticsearch
    await DeliveryService.markCompleted(emailJobId, sendResult);
    log.info({ messageId: sendResult.messageId }, 'Job processed and completed successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ err: errorMessage }, 'Error while dispatching email');

    const isMaxAttempts = acquiredJob.attempts >= acquiredJob.maxAttempts;
    await DeliveryService.markFailed(emailJobId, errorMessage, isMaxAttempts);

    throw error; // Re-throw so BullMQ records the failure and handles retry/backoff
  } finally {
    clearInterval(heartbeatInterval);
  }
}

// Initialize BullMQ Worker Pool with 5 concurrent workers
export const emailWorker = new Worker<EmailJobPayload>(EMAIL_QUEUE_NAME, processEmailJob, {
  connection: redisConfig,
  concurrency: env.WORKER_CONCURRENCY,
});

emailWorker.on('ready', () => {
  logger.info(
    { workerInstanceId, concurrency: env.WORKER_CONCURRENCY },
    '🚀 BullMQ Worker cluster is online and listening for jobs'
  );
});

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'BullMQ job failed');
});

// Run startup recovery when worker boots up
(async () => {
  logger.info('Initializing BullMQ Worker Engine...');
  const recovered = await RecoveryService.reconcileStaleLeases();
  logger.info({ recovered }, 'Startup lease reconciliation completed');

  // Start periodic 30-second sweep
  RecoveryService.startPeriodicReconciler(30000);
})();
