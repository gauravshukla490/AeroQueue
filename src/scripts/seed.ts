import { prisma } from '../lib/prisma.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { logger } from '../config/logger.js';

async function main() {
  logger.info('🌱 Seeding database...');

  // 1. Create Demo Sender
  const sender = await prisma.sender.upsert({
    where: { email: 'growth@startup.io' },
    update: {},
    create: {
      email: 'growth@startup.io',
      name: 'Growth Outreach Team',
      hourlyQuota: 200,
      minDelayMs: 2000,
      isActive: true,
    },
  });

  logger.info({ senderId: sender.id, email: sender.email }, 'Sender created');

  // 2. Create Sample Campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: 'Q4 Product Launch Announcement',
      senderId: sender.id,
      status: 'SCHEDULED',
    },
  });

  logger.info({ campaignId: campaign.id }, 'Campaign created');

  // 3. Schedule 5 Sample Emails (spaced 5 seconds apart)
  const sampleRecipients = [
    'alice@example.com',
    'bob@example.com',
    'carol@example.com',
    'dave@example.com',
    'eve@example.com',
  ];

  for (let i = 0; i < sampleRecipients.length; i++) {
    const scheduledAt = new Date(Date.now() + i * 5000); // starts now, +5s, +10s...
    await SchedulerService.scheduleEmail({
      senderId: sender.id,
      campaignId: campaign.id,
      recipient: sampleRecipients[i],
      subject: `Welcome to the Platform, ${sampleRecipients[i].split('@')[0]}!`,
      body: `<h1>Exclusive Preview</h1><p>Hey there, thanks for checking out our new release.</p>`,
      scheduledAt,
      idempotencyKey: `seed-job-${campaign.id}-${sampleRecipients[i]}`,
    });
  }

  logger.info('✅ Database seeded with demo sender, campaign, and 5 delayed email jobs!');
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
