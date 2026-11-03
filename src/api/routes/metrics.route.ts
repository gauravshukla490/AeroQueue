import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { emailQueue } from '../../queue/email.queue.js';
import { redisClient } from '../../lib/redis.js';
import { EmailJobStatus } from '@prisma/client';

export const metricsRouter = Router();

metricsRouter.get('/overview', async (req, res, next) => {
  try {
    // 1. Grouped counts from PostgreSQL state
    const statusCounts = await prisma.emailJob.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const counts: Record<string, number> = {
      PENDING: 0,
      QUEUED: 0,
      PROCESSING: 0,
      SENT: 0,
      FAILED: 0,
      CANCELLED: 0,
    };

    statusCounts.forEach((sc) => {
      counts[sc.status] = sc._count._all;
    });

    // 2. BullMQ queue counts
    const queueCounts = await emailQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    );

    // 3. Senders and their active sliding-window quota usage
    const senders = await prisma.sender.findMany({
      where: { isActive: true },
      take: 5,
    });

    const now = Date.now();
    const clearBefore = now - 3600 * 1000;

    const senderQuotas = await Promise.all(
      senders.map(async (sender) => {
        const key = `ratelimit:sender:${sender.id}`;
        await redisClient.zremrangebyscore(key, 0, clearBefore);
        const used = await redisClient.zcard(key);
        return {
          id: sender.id,
          email: sender.email,
          name: sender.name,
          hourlyQuota: sender.hourlyQuota,
          usedInWindow: used,
          remaining: Math.max(0, sender.hourlyQuota - used),
          percentUsed: Math.min(100, Math.round((used / sender.hourlyQuota) * 100)),
        };
      })
    );

    // 4. Recent jobs for live feed
    const recentJobs = await prisma.emailJob.findMany({
      take: 12,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          select: { email: true, name: true },
        },
        deliveryLogs: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // 5. Total processed and delivery success rate
    const totalDispatched = counts[EmailJobStatus.SENT] + counts[EmailJobStatus.FAILED];
    const successRate =
      totalDispatched > 0
        ? Math.round((counts[EmailJobStatus.SENT] / totalDispatched) * 100)
        : 100;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        totalSent: counts[EmailJobStatus.SENT],
        totalQueued: counts[EmailJobStatus.QUEUED],
        totalProcessing: counts[EmailJobStatus.PROCESSING],
        totalFailed: counts[EmailJobStatus.FAILED],
        totalPending: counts[EmailJobStatus.PENDING],
        successRate,
      },
      queueCounts,
      senderQuotas,
      recentJobs,
    });
  } catch (err) {
    next(err);
  }
});
