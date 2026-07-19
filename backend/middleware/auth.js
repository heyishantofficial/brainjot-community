const User = require('../models/User');

// Community session auth. After SSO exchange, req.session.userId holds the (main
// app) user id. These middlewares gate the API. We attach a lightweight req.user
// so handlers can snapshot the author without re-querying.

async function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const user = await User.findOne({ id: userId }).lean();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.banned) return res.status(403).json({ error: 'Account suspended' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Optional auth — populates req.user if logged in, but doesn't block. Used on
// read endpoints so we can attach "did I vote on this" without forcing login.
async function optionalAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();
  try {
    req.user = await User.findOne({ id: userId }).lean();
  } catch { /* ignore — treat as anonymous */ }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Sudo mode for the admin dashboard: role alone is not enough — the session must
// also have been unlocked with ADMIN_DASH_PASSWORD recently. Protects against a
// hijacked (but logged-in) superadmin session. Fail-closed when unconfigured.
const ADMIN_UNLOCK_TTL = 30 * 60 * 1000;

function adminUnlocked(req) {
  const at = req.session?.adminUnlockedAt;
  return typeof at === 'number' && Date.now() - at < ADMIN_UNLOCK_TTL;
}

function requireAdminUnlock(req, res, next) {
  if (!process.env.ADMIN_DASH_PASSWORD) {
    return res.status(503).json({ error: 'Admin password not configured on the server', code: 'ADMIN_PASSWORD_UNSET' });
  }
  if (!adminUnlocked(req)) {
    return res.status(401).json({ error: 'Admin unlock required', code: 'ADMIN_LOCKED' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin, requireAdminUnlock, adminUnlocked, ADMIN_UNLOCK_TTL };
