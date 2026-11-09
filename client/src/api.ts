// Typed client for the AeroQueue REST API (same origin, proxied in dev).

export type JobStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface Job {
  id: string;
  recipient: string;
  subject: string;
  status: JobStatus;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  sender: { email: string; name: string | null };
}

export interface SenderQuota {
  id: string;
  email: string;
  name: string | null;
  hourlyQuota: number;
  usedInWindow: number;
  remaining: number;
  percentUsed: number;
}

export interface Overview {
  timestamp: string;
  stats: {
    totalSent: number;
    totalQueued: number;
    totalProcessing: number;
    totalFailed: number;
    totalPending: number;
    successRate: number;
  };
  queueCounts: Record<string, number>;
  senderQuotas: SenderQuota[];
  recentJobs: Job[];
}

export interface Sender {
  id: string;
  email: string;
  name: string | null;
  hourlyQuota: number;
  minDelayMs: number;
  isActive: boolean;
}

export interface SearchHit {
  id: string;
  emailJobId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  status: JobStatus;
  attempts: number;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

export interface Health {
  status: string;
  services: Record<string, string>;
}

export class ApiError extends Error {
  details: { path: string; message: string }[];
  constructor(message: string, details: { path: string; message: string }[] = []) {
    super(message);
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the AeroQueue API.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok && !(path.includes('/health') && data)) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, data?.details ?? []);
  }
  return data as T;
}

export const api = {
  health: () => request<Health>('/api/health'),
  overview: () => request<Overview & { success: boolean }>('/api/metrics/overview'),
  senders: () => request<{ senders: Sender[] }>('/api/senders'),
  addSender: (body: { email: string; name?: string; hourlyQuota?: number; minDelayMs?: number }) =>
    request<{ sender: Sender }>('/api/senders', { method: 'POST', body: JSON.stringify(body) }),
  schedule: (body: {
    senderId: string;
    recipient: string;
    subject: string;
    body: string;
    scheduledAt?: string;
    idempotencyKey?: string;
  }) =>
    request<{ emailJobId: string; status: JobStatus; scheduledAt: string; isDuplicate: boolean }>(
      '/api/emails/schedule',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  campaign: (body: {
    name: string;
    senderId: string;
    recipients: { recipient: string; subject?: string; body?: string }[];
    startAt?: string;
    spacingSeconds: number;
  }) =>
    request<{ campaign: { id: string; name: string }; totalScheduled: number }>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancel: (id: string) => request<{ message: string }>(`/api/emails/${id}`, { method: 'DELETE' }),
  search: (p: { q?: string; status?: string; size?: number }) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set('q', p.q);
    if (p.status) qs.set('status', p.status);
    qs.set('size', String(p.size ?? 12));
    return request<{ total: number; results: SearchHit[] }>(`/api/search?${qs}`);
  },
};
