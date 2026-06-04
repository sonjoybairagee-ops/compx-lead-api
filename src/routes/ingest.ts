import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { addBatch } from '../queue/leadQueue';

export const ingestRouter = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const LeadSchema = z.object({
  source: z.enum(['google_maps', 'linkedin']),
  name: z.string().min(1).max(200),
  website: z.string().url('website must be a valid URL').optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  industry: z.string().optional(),
  employeeCount: z.string().optional(),
  linkedin_url: z.string().url('linkedin_url must be a valid URL').optional(),
  capturedAt: z.number().int().optional(),
});

const BatchSchema = z.object({
  leads: z
    .array(LeadSchema)
    .min(1, 'At least 1 lead is required')
    .max(50, 'Maximum 50 leads per batch'),
  batch_size: z.number().int().positive().optional(),
});

// ─── POST /api/ingest ─────────────────────────────────────────────────────────

ingestRouter.post(
  '/ingest',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
      const jobId = await addBatch(leads, userId);

      // ── 4. Respond ─────────────────────────────────────────────────────────
      res.status(202).json({
        success: true,
        jobId,
        queued: leads.length,
        message: 'Batch queued for processing',
      });
    } catch (err) {
      // Surface queue / Redis errors without exposing internals in production
      console.error('[ingest] Failed to enqueue batch:', err);
      next(err);
    }
  }
);
