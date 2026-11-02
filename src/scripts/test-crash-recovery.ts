import { prisma } from '../lib/prisma.js';
import { RecoveryService } from '../services/recovery.service.js';
import { logger } from '../config/logger.js';
import { EmailJobStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

async function testCrashRecovery() {
  logger.info('🧪 Starting Crash Recovery & Lease Expiry Test...');

  // 1. Ensure sender exists
  const sender = await prisma.sender.upsert({
    where: { email: 'recovery-test@example.com' },
    update: {},
    create: {
      email: 'recovery-test@example.com',
      name: 'Recovery Tester',
    },
  });

  // 2. Insert a simulated "zombie" job that died mid-flight 2 minutes ago
  const simulatedExpiredTime = new Date(Date.now() - 120 * 1000);

  const zombieJob = await prisma.emailJob.create({
    data: {
      senderId: sender.id,
      recipient: 'zombie-victim@example.com',
      subject: 'Zombie Job Test',
      body: '<p>This job died when worker crashed.</p>',
      status: EmailJobStatus.PROCESSING,
      workerId: `worker-dead-${randomUUID().slice(0, 6)}`,
      leaseExpiresAt: simulatedExpiredTime,
      attempts: 1,
      idempotencyKey: `crash-test-${Date.now()}`,
    },
  });

  logger.info(
    { jobId: zombieJob.id, leaseExpiresAt: zombieJob.leaseExpiresAt },
    'Created simulated crashed job in PROCESSING state'
  );

  // 3. Trigger reconciliation
  logger.info('Invoking RecoveryService.reconcileStaleLeases()...');
  const recovered = await RecoveryService.reconcileStaleLeases();

  // 4. Inspect DB state
  const updatedJob = await prisma.emailJob.findUnique({
    where: { id: zombieJob.id },
    include: { deliveryLogs: true },
  });

  logger.info(
    {
      recoveredCount: recovered,
      newStatus: updatedJob?.status,
      workerId: updatedJob?.workerId,
      leaseExpiresAt: updatedJob?.leaseExpiresAt,
      deliveryLogsCount: updatedJob?.deliveryLogs.length,
    },
    'Recovery verification inspect'
  );

  if (updatedJob?.status === EmailJobStatus.QUEUED && updatedJob.workerId === null) {
    logger.info('🎉 Crash Recovery Test PASSED! Job was automatically healed and requeued.');
  } else {
    logger.error('❌ Crash Recovery Test FAILED! Status was not restored to QUEUED.');
  }

  process.exit(0);
}

testCrashRecovery().catch((err) => {
  logger.error({ err }, 'Recovery test error');
  process.exit(1);
});
