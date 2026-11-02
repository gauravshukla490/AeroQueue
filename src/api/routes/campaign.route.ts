import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { SchedulerService } from '../../services/scheduler.service.js';
import { z } from 'zod';

export const campaignRouter = Router();

const createCampaignSchema = z.object({
  name: z.string().min(1),
  senderId: z.string().uuid(),
  recipients: z
    .array(
      z.object({
        recipient: z.string().email(),
        subject: z.string().optional(),
        body: z.string().optional(),
      })
    )
    .min(1),
  startAt: z.string().datetime().optional(),
  spacingSeconds: z.number().int().min(1).default(2),
});

// Create campaign and schedule emails
campaignRouter.post('/', async (req, res, next) => {
  try {
    const data = createCampaignSchema.parse(req.body);

    const campaign = await prisma.campaign.create({
      data: {
        name: data.name,
        senderId: data.senderId,
        status: 'SCHEDULED',
      },
    });

    const result = await SchedulerService.scheduleCampaignBatch(
      campaign.id,
      data.recipients,
      {
        baseScheduledAt: data.startAt ? new Date(data.startAt) : new Date(),
        spacingSeconds: data.spacingSeconds,
      }
    );

    res.status(202).json({
      success: true,
      campaign,
      totalScheduled: result.count,
    });
  } catch (err) {
    next(err);
  }
});

// Get campaign status and breakdown
campaignRouter.get('/:id', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        sender: true,
        emailJobs: {
          select: {
            id: true,
            recipient: true,
            status: true,
            scheduledAt: true,
            sentAt: true,
            attempts: true,
          },
        },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const counts = campaign.emailJobs.reduce(
      (acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    res.json({
      success: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        sender: campaign.sender.email,
        counts,
        jobs: campaign.emailJobs,
      },
    });
  } catch (err) {
    next(err);
  }
});
