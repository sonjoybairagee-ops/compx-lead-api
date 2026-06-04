import { Queue } from 'bullmq';
import Redis from 'ioredis';

// ─── Redis Connection ─────────────────────────────────────────────────────────
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('Missing required env var: REDIS_URL');
}

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Reconnection strategy: exponential backoff, capped at 30 s
  retryStrategy(times: number): number {
    const delay = Math.min(times * 500, 30_000);
    console.warn(`[redis] Connection retry #${times} in ${delay}ms`);
    return delay;
  },
});

connection.on('connect', () => console.log('[redis] Connected'));
connection.on('error', (err: Error) =>
  console.error('[redis] Connection error:', err.message)
);

// ─── BullMQ Queue ─────────────────────────────────────────────────────────────
export const leadQueue = new Queue('leads', { connection });

// ─── addBatch helper ──────────────────────────────────────────────────────────
export interface LeadPayload {
  source: string;
  name: string;
  website?: string | null;
  phone?: string | null;
  location?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  industry?: string | null;
  employeeCount?: string | null;
  linkedin_url?: string | null;
  capturedAt?: number | null;
}

export interface LeadJob {
  lead: LeadPayload;
  userId: string;
  addedAt: number;
}

export async function addBatch(
  leads: LeadPayload[],
  userId: string
): Promise<string[]> {
  const jobs = leads.map((lead) => ({
    name: 'lead-job',
    data: {
      lead,
      userId,
      addedAt: Date.now(),
    } satisfies LeadJob,
    opts: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86_400 },
    },
  }));

  const addedJobs = await leadQueue.addBulk(jobs);
  return addedJobs.map((j) => j.id || '');
}
