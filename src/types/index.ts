import { EmailJobStatus } from '@prisma/client';

export interface EmailJobPayload {
  emailJobId: string;
  senderId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  idempotencyKey?: string | null;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  retryAfterSeconds?: number;
}

export interface ElasticsearchEmailLog {
  id: string;
  emailJobId: string;
  senderId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailJobStatus;
  attempts: number;
  errorMessage?: string | null;
  sentAt?: Date | null;
  createdAt: Date;
}
