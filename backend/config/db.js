const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ── Cached MongoDB connection ────────────────────────────────────────────────
// The connection promise is cached on the global object so concurrent callers
// (and the per-request ensure-DB gate in server.js) share ONE connection pool
// instead of opening a new one each time. On a long-running server this mostly
// means boot connects once and every later call resolves instantly; it also
// lets the gate retry cleanly if the initial connect failed.
//
// This is a SEPARATE database (and ideally a separate cluster) from the main app.
let cached = global.__bjcMongoose;
if (!cached) cached = global.__bjcMongoose = { conn: null, promise: null, listeners: false };

async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      logger.fatal('[startup] MONGODB_URI is required.');
      throw new Error('MONGODB_URI missing');
    }
    if (!cached.listeners) {
      mongoose.connection.on('error', (err) => logger.error({ err }, '[mongo] connection error'));
      mongoose.connection.on('disconnected', () => logger.warn('[mongo] disconnected'));
      cached.listeners = true;
    }
    cached.promise = mongoose
      .connect(uri, {
        maxPoolSize: parseInt(process.env.MONGO_MAX_POOL || '10', 10),
        serverSelectionTimeoutMS: 10000,
        // Fail fast instead of buffering queries while (re)connecting — the
        // ensure-DB middleware guarantees we're connected before any route runs.
        bufferCommands: false,
      })
      .then(async (m) => {
        logger.info('[mongo] connected');
        // Build every model's indexes explicitly. With bufferCommands:false,
        // Mongoose's automatic index creation is silently dropped (the
        // createIndex calls fire before the connection exists and cannot
        // buffer), so without this the unique constraints (votes, pairKey)
        // and all feed/search indexes would never exist. createIndexes() (not
        // init(), which just returns the original failed attempt) actually
        // issues the builds; it's a no-op when the indexes already exist.
        await Promise.all(
          Object.values(mongoose.models).map((model) =>
            model.createIndexes().catch((err) => logger.error({ err, model: model.modelName }, '[mongo] index build failed')),
          ),
        );
        logger.info('[mongo] indexes ensured');
        return m.connection;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // let the next invocation retry
    throw err;
  }
  return cached.conn;
}

module.exports = { connectDB };
