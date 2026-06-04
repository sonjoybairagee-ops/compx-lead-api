import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { addBatch } from '../queue/leadQueue';
import { createClient } from '@supabase/supabase-js';

export const ingestRouter = Router();

// ─── Supabase admin client ────────────────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── Supported sources (extension এর PLATFORMS list এর সাথে sync) ────────────
const SUPPORTED_SOURCES = [
  'google_maps',
  'yellow_pages',
  'linkedin',
  'facebook_biz',
  'yelp',
  'amazon_seller',
  'clutch',
  'g2',
  'instagram_biz',
] as const;

// Credit cost per source (scrape API এর মতোই)
const CREDIT_COST: Record<string, number> = {
  google_maps:   2,
  yellow_pages:  1,
  linkedin:      3,
  facebook_biz:  2,
  yelp:          1,
  amazon_seller: 2,
  clutch:        1,
  g2:            1,
  instagram_biz: 2,
};

// ─── Validation Schema ────────────────────────────────────────────────────────
const LeadSchema = z.object({
  // extension থেকে company_name, SaaS থেকে name — দুটোই accept করো
  company_name: z.string().min(1).max(200).optional(),
  name:         z.string().min(1).max(200).optional(),

  source: z.enum(SUPPORTED_SOURCES),

  website:       z.string().url().nullish(),
  phone:         z.string().nullish(),
  address:       z.string().nullish(),
  location:      z.string().nullish(),
  email:         z.string().email().nullish(),
  rating:        z.union([z.number(), z.string()]).nullish().transform(val => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }),
  review_count:  z.union([z.string(), z.number()]).nullish(),
  reviewCount:   z.union([z.number(), z.string()]).nullish(),
  industry:      z.string().nullish(),
  company_size:  z.string().nullish(),
  employeeCount: z.string().nullish(),
  linkedin_url:  z.string().url().nullish(),
  detail_url:    z.string().nullish(),
  category:      z.string().nullish(),
  description:   z.string().max(1000).nullish(),
  founded:       z.string().nullish(),
  scraped_at:    z.number().int().nullish(),
  capturedAt:    z.number().int().nullish(),
  metadata:      z.record(z.unknown()).nullish(),
}).refine(
  (data) => !!(data.company_name || data.name),
  { message: 'company_name or name is required' }
);

const BatchSchema = z.object({
  leads:      z.array(LeadSchema).min(1).max(50),
  batch_size: z.number().int().positive().optional(),
  user_id:    z.string().uuid().optional(), // extension থেকে আসতে পারে
});

// ─── Credit check & deduction ─────────────────────────────────────────────────
async function deductCredits(userId: string, amount: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();

  if (error || !data) return false;
  if (data.credits < amount) return false;

  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({ credits: data.credits - amount })
    .eq('id', userId);

  return !updateErr;
}

// ─── Normalize lead (company_name/name unify) ─────────────────────────────────
function normalizeLead(lead: z.infer<typeof LeadSchema>, userId: string) {
  return {
    company_name: lead.company_name || lead.name || 'Unknown',
    source:       lead.source,
    website:      lead.website || null,
    phone:        lead.phone || null,
    address:      lead.address || lead.location || null,
    email:        lead.email || null,
    rating:       lead.rating || null,
    review_count: String(lead.review_count || lead.reviewCount || ''),
    industry:     lead.industry || null,
    company_size: lead.company_size || lead.employeeCount || null,
    linkedin_url: lead.linkedin_url || null,
    detail_url:   lead.detail_url || null,
    category:     lead.category || null,
    description:  lead.description || null,
    founded:      lead.founded || null,
    scraped_at:   lead.scraped_at || lead.capturedAt || Date.now(),
    metadata:     lead.metadata || null,
    user_id:      userId,
    created_at:   new Date().toISOString(),
  };
}

// ─── POST /api/ingest ─────────────────────────────────────────────────────────
ingestRouter.post(
  '/ingest',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // ── 1. Validate ─────────────────────────────────────────────────────────
      const parseResult = BatchSchema.safeParse(req.body);

      if (!parseResult.success) {
        res.status(422).json({
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        });
        return;
      }

      const { leads } = parseResult.data;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // ── 2. Credit check ─────────────────────────────────────────────────────
      // প্রতিটি lead এর source অনুযায়ী credit cost হিসাব করো
      const totalCreditCost = leads.reduce((sum, lead) => {
        return sum + (CREDIT_COST[lead.source] || 1);
      }, 0);

      const hasCredits = await deductCredits(userId, totalCreditCost);
      if (!hasCredits) {
        res.status(402).json({
          error: 'Insufficient credits',
          required: totalCreditCost,
          message: `This batch needs ${totalCreditCost} credits.`,
        });
        return;
      }

      // ── 3. Normalize leads ──────────────────────────────────────────────────
      const normalized = leads.map((lead) => normalizeLead(lead, userId));

      // ── 4. Duplicate check — same user + same website/phone ─────────────────
      const websites = normalized.map(l => l.website).filter(Boolean);
      const { data: existing } = await supabaseAdmin
        .from('extension_database')
        .select('website')
        .eq('user_id', userId)
        .in('website', websites as string[]);

      const existingWebsites = new Set((existing || []).map(e => e.website));
      const newLeads    = normalized.filter(l => !l.website || !existingWebsites.has(l.website));
      const skippedCount = normalized.length - newLeads.length;

      if (newLeads.length === 0) {
        res.status(200).json({
          success: true,
          queued:  0,
          skipped: skippedCount,
          message: 'All leads already exist in your database.',
        });
        return;
      }

      // ── 5. Enqueue ──────────────────────────────────────────────────────────
      const jobIds = await addBatch(newLeads, userId);

      // ── 6. Respond ──────────────────────────────────────────────────────────
      res.status(202).json({
        success:      true,
        jobIds,
        queued:       newLeads.length,
        skipped:      skippedCount,
        creditsUsed:  totalCreditCost,
        message:      `${newLeads.length} lead(s) queued${skippedCount > 0 ? `, ${skippedCount} duplicate(s) skipped` : ''}.`,
      });

    } catch (err) {
      console.error('[ingest] Failed to enqueue batch:', err);
      next(err);
    }
  }
);
