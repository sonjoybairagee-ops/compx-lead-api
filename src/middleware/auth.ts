import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

// ─── Augment Express Request ──────────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string | undefined;
      };
    }
  }
}

// ─── Supabase admin client (singleton) ───────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    const xUserId = req.headers['x-user-id'] as string | undefined;

    // ── Path 1: Bearer JWT via Supabase ──────────────────────────────────────
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();

      if (!token) {
        res.status(401).json({ error: 'Unauthorized: missing token' });
        return;
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !data?.user) {
        console.warn('[auth] Invalid JWT:', error?.message ?? 'no user returned');
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      req.user = {
        id: data.user.id,
        email: data.user.email,
      };

      return next();
    }

    // ── Path 2: x-user-id header (internal worker / service calls) ───────────
    if (xUserId && xUserId.trim()) {
      // This path is intended for trusted internal callers (e.g., queue workers).
      // Ensure your network / firewall prevents external callers from spoofing this header.
      req.user = {
        id: xUserId.trim(),
        email: undefined,
      };

      return next();
    }

    // ── No credentials provided ───────────────────────────────────────────────
    res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    console.error('[auth] Unexpected error during authentication:', err);
    res.status(401).json({ error: 'Unauthorized' });
  }
}
