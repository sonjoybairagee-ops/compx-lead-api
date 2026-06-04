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
    const job = await exports.leadQueue.add('lead-batch', {
        leads,
        userId,
        addedAt: Date.now(),
    }, {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        // Remove completed jobs after 1 hour to keep Redis lean
        removeOnComplete: { age: 3600 },
        // Keep failed jobs for 24 hours for debugging
        removeOnFail: { age: 86400 },
    });
    return job.id;
}
//# sourceMappingURL=leadQueue.js.map