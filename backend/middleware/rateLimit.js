const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const logger = require('../utils/logger');

// ── Rate limiting on the SHARED Mongo connection ─────────────────────────────
// Limits must hold across every serverless instance (an in-memory limiter would
// give an attacker N× the limit across N instances), so counters live in Mongo.
//
// We deliberately do NOT use rate-limit-mongo: it opens its own MongoClient per
// limiter (4 limiters ≈ 16+ extra connections per instance — measured), which
// eats Atlas's connection budget fast on serverless. This store rides the same
// cached mongoose connection as everything else: zero extra connections.
//
// One atomic findOneAndUpdate per request implements the fixed window:
// expired/missing window → start at 1; live window → $inc. A TTL index on
// resetTime garbage-collects old counters.
class SharedMongoStore {
  constructor(name) {
    this.name = name;
    this.indexEnsured = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  get collection() {
    return mongoose.connection.db.collection('ratelimits');
  }

  async ensureIndex() {
    if (this.indexEnsured) return;
    this.indexEnsured = true;
    try {
      await this.collection.createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 });
    } catch (err) {
      logger.warn({ err }, '[ratelimit] TTL index creation failed (non-fatal)');
    }
  }

  key(key) {
    return `${this.name}:${key}`;
  }

  async increment(key) {
    await connectDB();
    await this.ensureIndex();
    const now = new Date();
    const resetTime = new Date(now.getTime() + this.windowMs);
    const doc = await this.collection.findOneAndUpdate(
      { _id: this.key(key) },
      [{
        $set: {
          hits: {
            $cond: [{ $gt: ['$resetTime', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1],
          },
          resetTime: {
            $cond: [{ $gt: ['$resetTime', now] }, '$resetTime', resetTime],
          },
        },
      }],
      { upsert: true, returnDocument: 'after' },
    );
    return { totalHits: doc.hits, resetTime: doc.resetTime };
  }

  async decrement(key) {
    try {
      await this.collection.updateOne({ _id: this.key(key) }, { $inc: { hits: -1 } });
    } catch { /* best-effort */ }
  }

  async resetKey(key) {
    try {
      await this.collection.deleteOne({ _id: this.key(key) });
    } catch { /* best-effort */ }
  }
}

function makeLimiter({ windowMs, max, name }) {
  const opts = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Key by authenticated user when possible, else by IP (IPv6-normalized via
    // the library helper so v6 users can't sidestep the limit per-address).
    keyGenerator: (req) => req.session?.userId || ipKeyGenerator(req.ip),
    message: { error: 'Too many requests. Please slow down.' },
  };

  // Shared store in production; per-process memory store is fine for local dev.
  if (process.env.NODE_ENV === 'production') {
    opts.store = new SharedMongoStore(name);
  }

  return rateLimit(opts);
}

// Generous read limiter for browsing the feed.
const readLimiter = makeLimiter({ name: 'read', windowMs: 60 * 1000, max: 240 });
// Tight write limiter — creating posts/comments/messages is abuse-prone.
const writeLimiter = makeLimiter({ name: 'write', windowMs: 60 * 1000, max: 30 });
// Voting can be frequent but still bounded.
const voteLimiter = makeLimiter({ name: 'vote', windowMs: 60 * 1000, max: 100 });
// Auth/SSO exchange — protect the login handshake.
const authLimiter = makeLimiter({ name: 'auth', windowMs: 60 * 1000, max: 20 });

module.exports = { makeLimiter, readLimiter, writeLimiter, voteLimiter, authLimiter };
