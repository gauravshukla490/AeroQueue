import { prisma } from '../lib/prisma.js';
import { emailQueue, emailDLQ } from '../queue/email.queue.js';
import { EmailJobStatus } from '@prisma/client';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export class RecoveryService {
  /**
   * Reconciles orphan or crashed jobs whose 60-second lease expired without completion.
   * Runs on process startup and periodically via timer.
   */
  public static async reconcileStaleLeases(): Promise<number> {
    const now = new Date();

    // Find all in-flight jobs where the worker lease has expired
    const expiredJobs = await prisma.emailJob.findMany({
      where: {
        status: EmailJobStatus.PROCESSING,
        leaseExpiresAt: {
          lte: now,
        },
      },
      include: {
        sender: true,
      },
      take: 100, // Batch process to prevent memory spikes
    });

    if (expiredJobs.length === 0) {
      return 0;
    }

    logger.warn(
      { count: expiredJobs.length },
      'Found expired send leases! Executing crash recovery...'
    );

    let recoveredCount = 0;

    for (const job of expiredJobs) {
      const willRetry = job.attempts < job.maxAttempts;

      if (willRetry) {
        // Reset to QUEUED and re-push into BullMQ
        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: job.id },
            data: {
              status: EmailJobStatus.QUEUED,
              leaseExpiresAt: null,
              workerId: null,
              lastError: `Recovered by StartupReconciler: worker lease expired at ${job.leaseExpiresAt?.toISOString()}`,
            },
          }),
          prisma.deliveryLog.create({
            data: {
              emailJobId: job.id,
              status: EmailJobStatus.QUEUED,
              errorMessage: `Lease expired on worker ${job.workerId}. Job automatically recovered and requeued.`,
            },
          }),
        ]);

        // Push back into BullMQ for re-execution
        await emailQueue.add(
          'dispatch-email',
          {
            emailJobId: job.id,
            senderId: job.senderId,
            senderEmail: job.sender.email,
            recipient: job.recipient,
            subject: job.subject,
            body: job.body,
            idempotencyKey: job.idempotencyKey,
          },
          {
            jobId: `${job.id}-retry-${job.attempts + 1}`,
            delay: 1000, // immediate 1s delay
          }
        );

        logger.info(
          { jobId: job.id, recipient: job.recipient, attempts: job.attempts },
          'Successfully recovered and requeued stale job'
        );
      } else {
        // Max attempts exceeded: mark permanently failed and route to DLQ
        await prisma.$transaction([
          prisma.emailJob.update({
            where: { id: job.id },
            data: {
              status: EmailJobStatus.FAILED,
              leaseExpiresAt: null,
              workerId: null,
              lastError: 'Max attempts reached after worker lease expiration',
            },
          }),
          prisma.deliveryLog.create({
            data: {
              emailJobId: job.id,
              status: EmailJobStatus.FAILED,
              errorMessage: 'Max attempts exceeded without worker lease completion. Sent to DLQ.',
            },
          }),
        ]);

        await emailDLQ.add('dlq-job', {
          emailJobId: job.id,
          senderId: job.senderId,
          senderEmail: job.sender.email,
          recipient: job.recipient,
          subject: job.subject,
          body: job.body,
          reason: 'Max retries exceeded due to worker lease expiry/crash',
        });

        logger.error(
          { jobId: job.id, recipient: job.recipient },
          'Stale job reached max retries, moved to Dead Letter Queue'
        );
      }

      recoveredCount++;
    }

    return recoveredCount;
  }

  /**
   * Starts periodic background reconciliation loop
   */
  public static startPeriodicReconciler(intervalMs = 30000): NodeJS.Timeout {
    logger.info({ intervalMs }, 'Starting periodic recovery background daemon');
    return setInterval(async () => {
      try {
        await this.reconcileStaleLeases();
      } catch (err) {
        logger.error({ err }, 'Error during periodic lease reconciliation');
      }
    }, intervalMs);
  }
}

// Standalone execution support
if (process.argv[1]?.endsWith('recovery.service.ts')) {
  (async () => {
    logger.info('Running manual lease reconciliation...');
    const recovered = await RecoveryService.reconcileStaleLeases();
    logger.info({ recovered }, 'Reconciliation finished.');
    process.exit(0);
  })();
}
