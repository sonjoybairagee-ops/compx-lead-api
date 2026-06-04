"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadQueue = exports.connection = void 0;
exports.addBatch = addBatch;
exports.closeQueue = closeQueue;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
// ─── Redis Connection ─────────────────────────────────────────────────────────
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    throw new Error('Missing required env var: REDIS_URL');
}
exports.connection = new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Upstash TLS support (rediss:// URL)
    tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    retryStrategy(times) {
        if (times > 10) {
            console.error('[redis] Max retries reached. Giving up.');
            return -1; // stop retrying
        }
        const delay = Math.min(times * 500, 30000);
        console.warn(`[redis] Retry #${times} in ${delay}ms`);
        return delay;
    },
});
exports.connection.on('connect', () => console.log('[redis] Connected ✓'));
exports.connection.on('error', (err) => console.error('[redis] Error:', err.message));
exports.connection.on('close', () => console.warn('[redis] Connection closed'));
// ─── BullMQ Queue ─────────────────────────────────────────────────────────────
exports.leadQueue = new bullmq_1.Queue('leads', {
    connection: exports.connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400, count: 1000 },
    },
});
// ─── addBatch ─────────────────────────────────────────────────────────────────
async function addBatch(leads, userId) {
    if (!leads.length)
        return [];
    const jobs = leads.map((lead) => ({
        name: `lead:${lead.source}`, // job name에 source 포함 — 디버깅 편함
        data: {
            lead,
            userId,
            addedAt: Date.now(),
        },
    }));
    const addedJobs = await exports.leadQueue.addBulk(jobs);
    return addedJobs.map((j) => j.id || '');
}
// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function closeQueue() {
    await exports.leadQueue.close();
    exports.connection.disconnect();
    console.log('[redis] Queue closed.');
}
//# sourceMappingURL=leadQueue.js.map