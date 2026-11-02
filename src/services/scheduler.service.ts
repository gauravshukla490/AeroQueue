import { prisma } from '../lib/prisma.js';
import { scheduleEmailJob } from '../queue/email.queue.js';
import { EmailJobStatus } from '@prisma/client';
import { logger } from '../config/logger.js';

export interface ScheduleEmailInput {
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt?: Date | string;
  campaignId?: string;
  idempotencyKey?: string;
}

export class SchedulerService {
  /**
   * Decoupled Ingestion: Records state in PostgreSQL and enqueues delayed job in BullMQ
   */
  public static async scheduleEmail(input: ScheduleEmailInput) {
    const {
      senderId,
      recipient,
      subject,
      body,
      campaignId,
      idempotencyKey,
      scheduledAt: rawScheduledAt,
    } = input;

    // 1. Idempotency Check: if key provided and job already exists, return it without duplicate creation
    if (idempotencyKey) {
      const existing = await prisma.emailJob.findUnique({
        where: { idempotencyKey },
        include: { sender: true },
      });
      if (existing) {
        logger.info({ idempotencyKey, jobId: existing.id }, 'Idempotent request: returning existing job');
        return { job: existing, isDuplicate: true };
      }
    }

    // 2. Validate sender exists and is active
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
    });

    if (!sender) {
      throw new Error(`Sender with ID ${senderId} not found`);
    }

    if (!sender.isActive) {
      throw new Error(`Sender with ID ${senderId} is inactive`);
    }

    const scheduledAt = rawScheduledAt ? new Date(rawScheduledAt) : new Date();

    // 3. Atomically persist state in PostgreSQL
    const emailJob = await prisma.emailJob.create({
      data: {
        senderId,
        recipient,
        subject,
        body,
        campaignId,
        idempotencyKey,
        scheduledAt,
        status: EmailJobStatus.PENDING,
      },
    });

    // 4. Enqueue into BullMQ with calculated delay
    const bullJobId = await scheduleEmailJob(
      {
        emailJobId: emailJob.id,
        senderId: sender.id,
        senderEmail: sender.email,
        recipient,
        subject,
        body,
        idempotencyKey,
      },
      scheduledAt
    );

    // 5. Update DB status to QUEUED
    const updated = await prisma.emailJob.update({
      where: { id: emailJob.id },
      data: { status: EmailJobStatus.QUEUED },
      include: { sender: true },
    });

    return { job: updated, bullJobId, isDuplicate: false };
  }

  /**
   * Bulk scheduling for campaigns
   */
  public static async scheduleCampaignBatch(
    campaignId: string,
    recipients: Array<{ recipient: string; subject?: string; body?: string }>,
    options?: { baseScheduledAt?: Date; spacingSeconds?: number }
  ) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { sender: true },
    });

    if (!campaign) {
      throw new Error(`Campaign with ID ${campaignId} not found`);
    }

    const baseTime = options?.baseScheduledAt ? new Date(options.baseScheduledAt).getTime() : Date.now();
    const spacingMs = (options?.spacingSeconds || 2) * 1000;

    const results = [];

    for (let i = 0; i < recipients.length; i++) {
      const item = recipients[i];
      const scheduledTime = new Date(baseTime + i * spacingMs);

      const scheduled = await this.scheduleEmail({
        senderId: campaign.senderId,
        campaignId: campaign.id,
        recipient: item.recipient,
        subject: item.subject || `Campaign: ${campaign.name}`,
        body: item.body || `<p>Hello from campaign ${campaign.name}</p>`,
        scheduledAt: scheduledTime,
        idempotencyKey: `campaign-${campaign.id}-${item.recipient}-${i}`,
      });

      results.push(scheduled);
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'IN_PROGRESS' },
    });

    return { count: results.length, jobs: results };
  }
}
