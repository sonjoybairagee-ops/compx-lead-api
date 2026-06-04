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
  website?: string;
  phone?: string;
  location?: string;
  rating?: number;
  reviewCount?: number;
  industry?: string;
  employeeCount?: string;
  linkedin_url?: string;
  capturedAt?: number;
}

export interface LeadBatchJob {
  leads: LeadPayload[];
  userId: string;
  addedAt: number;
}

export async function addBatch(
  leads: LeadPayload[],
  userId: string
): Promise<string | undefined> {
  const job = await leadQueue.add(
    'lead-batch',
    {
      leads,
      userId,
      addedAt: Date.now(),
    } satisfies LeadBatchJob,
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      // Remove completed jobs after 1 hour to keep Redis lean
      removeOnComplete: { age: 3600 },
      // Keep failed jobs for 24 hours for debugging
      removeOnFail: { age: 86_400 },
    }
  );

  return job.id;
}
