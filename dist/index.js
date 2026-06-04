"use strict";
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
// ─── Security Headers ────────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g., curl, server-to-server)
        if (!origin)
            return callback(null, true);
        // Allow Chrome Extensions
        if (origin.startsWith('chrome-extension://'))
            return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error(`CORS policy: origin '${origin}' not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
    credentials: true,
}));
// ─── Body Parser ─────────────────────────────────────────────────────────────
app.use(express_1.default.json({ limit: '1mb' }));
// ─── Rate Limiter ─────────────────────────────────────────────────────────────
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests, please try again after a minute.',
    },
});
app.use(limiter);
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});
// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', ingest_1.ingestRouter);
// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
});
// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[ERROR]', err.message);
    // CORS errors surfaced by the cors package
    if (err.message.startsWith('CORS policy:')) {
        return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({
        error: 'Internal Server Error',
        ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
    });
});
// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[server] Lead Intelligence API running on port ${PORT}`);
    console.log(`[server] Allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map