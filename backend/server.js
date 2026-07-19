require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const { connectDB } = require('./config/db');
const { buildSessionMiddleware } = require('./config/stores');
const User = require('./models/User');
const { recordActivity } = require('./utils/weeks');

// ── CORS: allow the community frontend + any *.brainjot.space subdomain ───────
function buildAllowedOrigins() {
  return new Set([
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5173', // main app dev — fetches the community badge count
    'http://127.0.0.1:5173',
    process.env.COMMUNITY_APP_URL,
    process.env.MAIN_APP_URL,
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ].filter(Boolean));
}
const ALLOWED = buildAllowedOrigins();

function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin / curl / server-to-server
  if (ALLOWED.has(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && (hostname === 'brainjot.space' || hostname.endsWith('.brainjot.space'));
  } catch { return false; }
}

// Build the Express app. No DB connect, no listen — the app is assembled here
// and started at the bottom of this file (keeps it importable for tests).
function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Dokploy's reverse proxy (Traefik)

  app.use(pinoHttp({
    logger,
    customLogLevel: (_req, res, err) => (res.statusCode >= 500 || err ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (req) => ({ method: req.method, url: req.url }) },
  }));

  app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Health check needs no DB — answer before the ensure-DB gate.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // ── Ensure-DB gate ─────────────────────────────────────────────────────
  // Every API request awaits the cached connection first. Once connected it
  // resolves instantly; if the DB dropped, this reconnects instead of letting
  // routes fail on a dead connection.
  app.use(async (_req, res, next) => {
    try { await connectDB(); next(); } catch (err) {
      logger.error({ err }, '[db] connect failed for request');
      res.status(503).json({ error: 'Service temporarily unavailable' });
    }
  });

  // Sessions (Mongo-backed, shared across instances and restarts).
  app.use(buildSessionMiddleware());

  // Idle session timeout (4h). lastActivity is only rewritten when it's >5 min
  // stale — touching it on every request would mean one Mongo session write per
  // authenticated request (brutal under DM polling). The 5-min granularity makes
  // the timeout effectively 4h ± 5min, which is fine.
  app.use((req, _res, next) => {
    if (req.session?.userId) {
      const last = req.session.lastActivity;
      const now = Date.now();
      if (last && now - last > 4 * 60 * 60 * 1000) {
        return req.session.destroy(() => next());
      }
      if (!last || now - last > 5 * 60 * 1000) {
        req.session.lastActivity = now;
        // Piggyback DAU tracking on the same 5-min granularity: without this,
        // lastSeenAt only moves at SSO login and the admin dashboard's DAU
        // number undercounts anyone riding a long session. Fire-and-forget.
        User.updateOne({ id: req.session.userId }, { $set: { lastSeenAt: new Date(now) } }).catch(() => {});
        recordActivity(req.session.userId); // weekly-activity row → growth accounting + cohorts
      }
    }
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────
  app.use('/api/auth', require('./routes/auth').router);
  app.use('/api/posts', require('./routes/posts').router);
  app.use('/api/comments', require('./routes/comments').router);
  app.use('/api/conversations', require('./routes/messages').router);
  app.use('/api/users', require('./routes/users').router);
  app.use('/api/reports', require('./routes/reports').router);
  app.use('/api/admin', require('./routes/admin').router);
  app.use('/api/notifications', require('./routes/notifications').router);
  app.use('/api/uploads', require('./routes/uploads').router);
  // Feature flags the frontend reads once at boot.
  app.get('/api/config', (_req, res) => res.json({ uploads: require('./routes/uploads').uploadsEnabled() }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error({ err, url: req.url }, '[api] unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const app = createApp();

// Connect, then listen. Skipped when the file is imported (e.g. tests) rather
// than run directly.
if (require.main === module) {
  const port = process.env.PORT || 4000;
  connectDB()
    .then(() => app.listen(port, () => logger.info(`[startup] community API on :${port}`)))
    .catch((err) => { logger.fatal({ err }, '[startup] failed to start'); process.exit(1); });
}

module.exports = app;
