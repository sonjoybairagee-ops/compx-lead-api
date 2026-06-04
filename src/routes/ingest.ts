import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { addBatch } from '../queue/leadQueue';

export const ingestRouter = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const LeadSchema = z.object({
  source: z.enum(['google_maps', 'linkedin']),
  name: z.string().min(1).max(200),
  website: z.string().url('website must be a valid URL').nullish(),
  phone: z.string().nullish(),
  location: z.string().nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().min(0).nullish(),
  industry: z.string().nullish(),
  employeeCount: z.string().nullish(),
  linkedin_url: z.string().url('linkedin_url must be a valid URL').nullish(),
  capturedAt: z.number().int().nullish(),
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

      // ── 3. Enqueue individual jobs ─────────────────────────────────────────
      const jobIds = await addBatch(leads, userId);

      // ── 4. Respond ─────────────────────────────────────────────────────────
      res.status(202).json({
        success: true,
        jobIds,
        queued: leads.length,
        message: 'Leads queued for processing individually',
      });
    } catch (err) {
      // Surface queue / Redis errors without exposing internals in production
      console.error('[ingest] Failed to enqueue batch:', err);
      next(err);
    }
  }
);
