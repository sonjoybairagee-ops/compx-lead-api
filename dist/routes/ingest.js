"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const leadQueue_1 = require("../queue/leadQueue");
exports.ingestRouter = (0, express_1.Router)();
// ─── Validation Schemas ───────────────────────────────────────────────────────
const LeadSchema = zod_1.z.object({
    source: zod_1.z.enum(['google_maps', 'linkedin']),
    name: zod_1.z.string().min(1).max(200),
    website: zod_1.z.string().url('website must be a valid URL').nullish(),
    phone: zod_1.z.string().nullish(),
    location: zod_1.z.string().nullish(),
    rating: zod_1.z.number().min(0).max(5).nullish(),
    reviewCount: zod_1.z.number().int().min(0).nullish(),
    industry: zod_1.z.string().nullish(),
    employeeCount: zod_1.z.string().nullish(),
    linkedin_url: zod_1.z.string().url('linkedin_url must be a valid URL').nullish(),
    capturedAt: zod_1.z.number().int().nullish(),
});
const BatchSchema = zod_1.z.object({
    leads: zod_1.z
        .array(LeadSchema)
        .min(1, 'At least 1 lead is required')
        .max(50, 'Maximum 50 leads per batch'),
    batch_size: zod_1.z.number().int().positive().optional(),
});
// ─── POST /api/ingest ─────────────────────────────────────────────────────────
exports.ingestRouter.post('/ingest', auth_1.authMiddleware, async (req, res, next) => {
    try {
        // ── 1. Validate body ────────────────────────────────────────────────────
        const parseResult = BatchSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(422).json({
                error: 'Validation failed',
                details: parseResult.error.flatten().fieldErrors,
            });
            return;
        }
        const { leads } = parseResult.data;
        // ── 2. Resolve user identity (set by authMiddleware) ───────────────────
        const userId = req.user?.id;
        if (!userId) {
            // Should never reach here because authMiddleware already guards this,
            // but we guard defensively for type safety.
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        // ── 3. Enqueue the batch ───────────────────────────────────────────────
        const jobId = await (0, leadQueue_1.addBatch)(leads, userId);
        // ── 4. Respond ─────────────────────────────────────────────────────────
        res.status(202).json({
            success: true,
            jobId,
            queued: leads.length,
            message: 'Batch queued for processing',
        });
    }
    catch (err) {
        // Surface queue / Redis errors without exposing internals in production
        console.error('[ingest] Failed to enqueue batch:', err);
        next(err);
    }
});
//# sourceMappingURL=ingest.js.map