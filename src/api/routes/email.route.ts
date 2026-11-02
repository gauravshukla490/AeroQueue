import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { SchedulerService } from '../../services/scheduler.service.js';
import { z } from 'zod';
import { EmailJobStatus } from '@prisma/client';

export const emailRouter = Router();

const scheduleEmailSchema = z.object({
  senderId: z.string().uuid(),
  recipient: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
  idempotencyKey: z.string().optional(),
});

// Schedule a single email (decoupled ingestion)
emailRouter.post('/schedule', async (req, res, next) => {
  try {
    const data = scheduleEmailSchema.parse(req.body);

    const result = await SchedulerService.scheduleEmail({
      senderId: data.senderId,
      recipient: data.recipient,
      subject: data.subject,
      body: data.body,
      scheduledAt: data.scheduledAt,
      idempotencyKey: data.idempotencyKey,
    });

    const statusCode = result.isDuplicate ? 200 : 202;

    res.status(statusCode).json({
      success: true,
      isDuplicate: result.isDuplicate,
      emailJobId: result.job.id,
      bullJobId: result.bullJobId,
      status: result.job.status,
      scheduledAt: result.job.scheduledAt,
    });
  } catch (err) {
    next(err);
  }
});

// Get email status and delivery logs
emailRouter.get('/:id', async (req, res, next) => {
  try {
    const job = await prisma.emailJob.findUnique({
      where: { id: req.params.id },
      include: {
        sender: true,
        deliveryLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Email job not found' });
      return;
    }

    res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
});

// Cancel a scheduled email if not yet processed
emailRouter.delete('/:id', async (req, res, next) => {
  try {
    const job = await prisma.emailJob.findUnique({
      where: { id: req.params.id },
    });

    if (!job) {
      res.status(404).json({ error: 'Email job not found' });
      return;
    }

    if (job.status === EmailJobStatus.SENT) {
      res.status(400).json({ error: 'Cannot cancel an email that has already been sent' });
      return;
    }

    const updated = await prisma.emailJob.update({
      where: { id: req.params.id },
      data: {
        status: EmailJobStatus.CANCELLED,
      },
    });

    res.json({ success: true, message: 'Email job cancelled', job: updated });
  } catch (err) {
    next(err);
  }
});
