"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const ingest_1 = require("./routes/ingest");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// ─── Security Headers ─────────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (origin.startsWith('chrome-extension://'))
            return callback(null, true);
        if (allowedOrigins.includes(origin))
            return callback(null, true);
        callback(new Error(`CORS policy: origin '${origin}' not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-client', 'x-client-info', 'apikey'],
    credentials: true,
}));
// ─── Body Parser ──────────────────────────────────────────────────────────────
app.use(express_1.default.json({ limit: '1mb' }));
// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Unauthenticated: strict (20/min)
const publicLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !!(req.headers['authorization'] || req.headers['x-user-id']),
    message: { error: 'Too many requests. Please sign in or try again later.' },
});
// Authenticated: generous (200/min)
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !(req.headers['authorization'] || req.headers['x-user-id']),
    keyGenerator: (req) => req.headers['authorization']?.slice(-16)
        || req.headers['x-user-id']
        || req.ip
        || 'unknown',
    message: { error: 'Rate limit exceeded. Please slow down.' },
});
app.use(publicLimiter);
app.use(authLimiter);
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', async (_req, res) => {
    // Basic DB connectivity check
    let dbStatus = 'unknown';
    try {
        const { createClient } = await Promise.resolve().then(() => __importStar(require('@supabase/supabase-js')));
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const { error } = await sb.from('users').select('id').limit(1);
        dbStatus = error ? 'degraded' : 'ok';
    }
    catch {
        dbStatus = 'error';
    }
    res.json({
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
            database: dbStatus,
            api: 'ok',
        },
    });
});
// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', ingest_1.ingestRouter);
// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
});
// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
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
async function shutdown(signal) {
    if (isShuttingDown)
        return;
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
    }, 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Unhandled errors log করো কিন্তু crash করো না
process.on('unhandledRejection', (reason) => {
    console.error('[server] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[server] Uncaught exception:', err);
    shutdown('uncaughtException');
});
exports.default = app;
//# sourceMappingURL=index.js.map