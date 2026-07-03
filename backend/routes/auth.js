const express = require('express');
const User = require('../models/User');
const { verifySsoToken } = require('../utils/sso');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

const router = express.Router();

// ── POST /api/auth/sso-login ─────────────────────────────────────────────────
// Exchange a main-app-issued SSO token for a community session. The frontend
// obtains the token by calling the main app's /api/community/sso-token (with
// credentials) and immediately posts it here. We verify locally, upsert a
// mirrored user, and start a session.
router.post('/sso-login', authLimiter, async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });

  let claims;
  try {
    claims = verifySsoToken(token);
  } catch (err) {
    if (err.code === 'NO_SECRET') {
      logger.fatal('[sso] COMMUNITY_JWT_SECRET not configured — cannot authenticate.');
      return res.status(500).json({ error: 'SSO not configured' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    // Upsert the mirrored user. We refresh identity fields from the token but
    // never clobber community-local fields (bio, skills, karma) — $setOnInsert
    // seeds them only on first login.
    const user = await User.findOneAndUpdate(
      { id: claims.id },
      {
        $set: {
          name: claims.name,
          username: claims.username,
          email: claims.email,
          avatarUrl: claims.avatarUrl,
          role: claims.role,
          lastSeenAt: new Date(),
        },
        $setOnInsert: { bio: '', skills: [], karma: 0, postCount: 0, createdAt: new Date() },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (user.banned) return res.status(403).json({ error: 'Account suspended' });

    // Fresh session id on privilege change — prevents session fixation.
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.userId = user.id;
    req.session.lastActivity = Date.now();

    res.json({ user: publicUser(user) });
  } catch (err) {
    logger.error({ err }, '[sso] login failed');
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('brainjot_community_session');
    res.json({ ok: true });
  });
});

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username || '',
    avatarUrl: u.avatarUrl || '',
    role: u.role || 'user',
    bio: u.bio || '',
    skills: u.skills || [],
    karma: u.karma || 0,
    followedTopics: u.followedTopics || [],
    blocked: u.blocked || [],
  };
}

module.exports = { router, publicUser };
