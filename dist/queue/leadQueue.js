"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadQueue = exports.connection = void 0;
exports.addBatch = addBatch;
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
    // Reconnection strategy: exponential backoff, capped at 30 s
    retryStrategy(times) {
        const delay = Math.min(times * 500, 30000);
        console.warn(`[redis] Connection retry #${times} in ${delay}ms`);
        return delay;
    },
});
exports.connection.on('connect', () => console.log('[redis] Connected'));
exports.connection.on('error', (err) => console.error('[redis] Connection error:', err.message));
// ─── BullMQ Queue ─────────────────────────────────────────────────────────────
exports.leadQueue = new bullmq_1.Queue('leads', { connection: exports.connection });
async function addBatch(leads, userId) {
    const jobs = leads.map((lead) => ({
        name: 'lead-job',
        data: {
            lead,
            userId,
            addedAt: Date.now(),
        },
        opts: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        },
    }));
    const addedJobs = await exports.leadQueue.addBulk(jobs);
    return addedJobs.map((j) => j.id || '');
}
//# sourceMappingURL=leadQueue.js.map