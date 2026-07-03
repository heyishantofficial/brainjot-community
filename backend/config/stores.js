const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { connectDB } = require('./db');

// ── Pluggable stores: single-instance today, horizontal tomorrow ─────────────
// The backend is fully STATELESS — nothing lives in process memory. Sessions and
// rate-limit counters go through external stores, so any number of serverless
// instances behave as one.
//
//   REDIS_URL unset  → sessions in Mongo (connect-mongo). Fine on serverless.
//   REDIS_URL set    → sessions in Redis (faster session reads at scale).

let redisClient = null;

// Lazily create (once) a shared redis client when configured.
function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;
  const { createClient } = require('redis');
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => logger.error({ err }, '[redis] error'));
  redisClient.connect().catch((err) => logger.error({ err }, '[redis] connect failed'));
  return redisClient;
}

function buildSessionStore() {
  if (process.env.REDIS_URL) {
    const { RedisStore } = require('connect-redis');
    logger.info('[stores] sessions → Redis');
    return new RedisStore({ client: getRedisClient(), prefix: 'bjc:sess:' });
  }
  logger.info('[stores] sessions → MongoDB');
  // Reuse the SAME cached connection the rest of the app uses (no second pool).
  // Going through connectDB() guarantees the client exists before connect-mongo
  // touches it — critical on serverless, where the store is built at cold start
  // before any request has triggered a connection.
  return MongoStore.create({
    clientPromise: connectDB().then(() => mongoose.connection.getClient()),
    collectionName: 'sessions',
  });
}

function buildSessionMiddleware() {
  const secrets = [process.env.SESSION_SECRET, process.env.SESSION_SECRET_PREVIOUS].filter(Boolean);
  if (secrets.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      logger.fatal('[startup] SESSION_SECRET is required in production.');
      process.exit(1);
    }
    secrets.push(require('crypto').randomBytes(32).toString('hex'));
    logger.warn('[startup] SESSION_SECRET not set — using a temporary secret (dev only).');
  }

  return session({
    secret: secrets,
    name: 'brainjot_community_session',
    resave: false,
    saveUninitialized: false,
    store: buildSessionStore(),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // 'lax': the frontend (community.brainjot.space) and this API
      // (api.community.brainjot.space) share the registrable domain
      // brainjot.space, so all real traffic is SAME-SITE and Lax cookies flow
      // normally — while cross-site pages can no longer ride the session on
      // forged requests (CSRF). Do not relax to 'none'.
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

module.exports = { buildSessionMiddleware, getRedisClient };
