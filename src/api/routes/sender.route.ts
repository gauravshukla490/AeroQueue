import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { redisClient } from '../../lib/redis.js';
import { z } from 'zod';

export const senderRouter = Router();

const createSenderSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  hourlyQuota: z.number().int().positive().default(200),
  minDelayMs: z.number().int().nonnegative().default(2000),
});

// Create or update a sender account
senderRouter.post('/', async (req, res, next) => {
  try {
    const data = createSenderSchema.parse(req.body);

    const sender = await prisma.sender.upsert({
      where: { email: data.email },
      update: {
        name: data.name,
        hourlyQuota: data.hourlyQuota,
        minDelayMs: data.minDelayMs,
        isActive: true,
      },
      create: data,
    });

    res.status(201).json({ success: true, sender });
  } catch (err) {
    next(err);
  }
});

// List all registered senders
senderRouter.get('/', async (req, res, next) => {
  try {
    const senders = await prisma.sender.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { emailJobs: true, campaigns: true },
        },
      },
    });

    res.json({ success: true, count: senders.length, senders });
  } catch (err) {
    next(err);
  }
});

// Get current sliding-window quota usage for a sender
senderRouter.get('/:id/quota', async (req, res, next) => {
  try {
    const sender = await prisma.sender.findUnique({
      where: { id: req.params.id },
    });

    if (!sender) {
      res.status(404).json({ error: 'Sender not found' });
      return;
    }

    const key = `ratelimit:sender:${sender.id}`;
    const now = Date.now();
    const clearBefore = now - 3600 * 1000;

    // Clean up stale and count in window
    await redisClient.zremrangebyscore(key, 0, clearBefore);
    const usedCount = await redisClient.zcard(key);

    res.json({
      success: true,
      senderId: sender.id,
      email: sender.email,
      hourlyQuota: sender.hourlyQuota,
      usedInCurrentHour: usedCount,
      remainingQuota: Math.max(0, sender.hourlyQuota - usedCount),
      minDelayMs: sender.minDelayMs,
    });
  } catch (err) {
    next(err);
  }
});
