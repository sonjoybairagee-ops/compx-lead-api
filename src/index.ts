import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

import { ingestRouter } from './routes/ingest';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS policy: origin '${origin}' not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-client', 'x-client-info', 'apikey'],
    credentials: true,
  })
);

// ─── Body Parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Unauthenticated: strict (20/min)
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !!(req.headers['authorization'] || req.headers['x-user-id']),
  message: { error: 'Too many requests. Please sign in or try again later.' },
});

// Authenticated: generous (200/min)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !(req.headers['authorization'] || req.headers['x-user-id']),
  keyGenerator: (req) =>
    (req.headers['authorization'] as string)?.slice(-16)
    || (req.headers['x-user-id'] as string)
    || req.ip
    || 'unknown',
  message: { error: 'Rate limit exceeded. Please slow down.' },
});

app.use(publicLimiter);
app.use(authLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', async (_req: Request, res: Response) => {
  // Basic DB connectivity check
  let dbStatus = 'unknown';
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error } = await sb.from('users').select('id').limit(1);
    dbStatus = error ? 'degraded' : 'ok';
  } catch {
    dbStatus = 'error';
  }

  res.json({
    status:    dbStatus === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version || '1.0.0',
    services: {
      database: dbStatus,
      api:      'ok',
    },
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', ingestRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ERROR]', err.message);
  if (err.message.startsWith('CORS policy:')) {
    return res.status(403).json({ error: err.message });
  }
  return res.status(500).json({
    error: 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] compX Lead API running on port ${PORT}`);
  console.log(`[server] Allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
  console.log(`[server] Rate limits: public=20/min, auth=200/min`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// Active request গুলো শেষ হওয়ার পরে server বন্ধ হবে
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[server] ${signal} received — shutting down gracefully...`);

  server.close((err) => {
    if (err) {
      console.error('[server] Error during shutdown:', err);
      process.exit(1);
    }
    console.log('[server] All connections closed. Bye!');
    process.exit(0);
  });

  // Force kill after 10s যদি connections না বন্ধ হয়
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Unhandled errors log করো কিন্তু crash করো না
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  shutdown('uncaughtException');
});

export default app;
