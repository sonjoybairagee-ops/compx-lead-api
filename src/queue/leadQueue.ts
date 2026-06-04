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
  // Upstash TLS support (rediss:// URL)
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  retryStrategy(times: number): number {
    if (times > 10) {
      console.error('[redis] Max retries reached. Giving up.');
      return -1; // stop retrying
    }
    const delay = Math.min(times * 500, 30_000);
    console.warn(`[redis] Retry #${times} in ${delay}ms`);
    return delay;
  },
});

connection.on('connect', () => console.log('[redis] Connected ✓'));
connection.on('error',   (err: Error) => console.error('[redis] Error:', err.message));
connection.on('close',   () => console.warn('[redis] Connection closed'));

// ─── BullMQ Queue ─────────────────────────────────────────────────────────────
export const leadQueue = new Queue('leads', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail:     { age: 86_400, count: 1000 },
  },
});

// ─── LeadPayload — সব platform এর fields ─────────────────────────────────────
export interface LeadPayload {
  // Core (required)
  company_name: string;
  source: string;

  // Contact
  website?:      string | null;
  phone?:        string | null;
  email?:        string | null;

  // Location
  address?:      string | null;
  location?:     string | null;

  // Business info
  rating?:       number | null;
  review_count?: string | null;
  reviewCount?:  number | null;
  industry?:     string | null;
  company_size?: string | null;
  employeeCount?:string | null;
  category?:     string | null;
  description?:  string | null;
  founded?:      string | number | null;

  // Platform-specific
  linkedin_url?: string | null;
  detail_url?:   string | null;

  // Meta
  scraped_at?:   number | null;
  capturedAt?:   number | null;
  metadata?:     Record<string, unknown> | null;

  // Legacy (backward compat)
  name?:         string;
}

export interface LeadJob {
  lead:    LeadPayload;
  userId:  string;
  addedAt: number;
}

// ─── addBatch ─────────────────────────────────────────────────────────────────
export async function addBatch(
  leads: LeadPayload[],
  userId: string
): Promise<string[]> {
  if (!leads.length) return [];

  const jobs = leads.map((lead) => ({
    name: `lead:${lead.source}`,   // job name에 source 포함 — 디버깅 편함
    data: {
      lead,
      userId,
      addedAt: Date.now(),
    } satisfies LeadJob,
  }));

  const addedJobs = await leadQueue.addBulk(jobs);
  return addedJobs.map((j) => j.id || '');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
export async function closeQueue(): Promise<void> {
  await leadQueue.close();
  connection.disconnect();
  console.log('[redis] Queue closed.');
}
