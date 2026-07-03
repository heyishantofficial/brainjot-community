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

module.exports = { requireAuth, optionalAuth, requireAdmin };
