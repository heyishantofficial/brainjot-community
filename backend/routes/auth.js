const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Endorsement = require('../models/Endorsement');
const Conversation = require('../models/Conversation');
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
    // Snapshot the previous identity so we know whether the denormalized
    // author copies (posts, comments, endorsements, DM participant blocks)
    // need a backfill after the upsert.
    const before = await User.findOne({ id: claims.id })
      .select('name username avatarUrl -_id').lean();

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

    // Identity changed on the main app (new avatar / display name / username) →
    // backfill the denormalized author snapshots so old content shows the new
    // identity. Runs only on an actual change, and in the background — a slow
    // backfill must never delay or fail the login itself.
    if (before && (before.avatarUrl !== user.avatarUrl || before.name !== user.name || before.username !== user.username)) {
      backfillAuthorSnapshots(user).catch((err) =>
        logger.error({ err, userId: user.id }, '[sso] author snapshot backfill failed'));
    }

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

// Propagate a changed identity into every denormalized author copy. Notifications
// are deliberately skipped — they expire in 90 days and show a tiny avatar once.
async function backfillAuthorSnapshots(user) {
  const author = { authorName: user.name, authorUsername: user.username || '', authorAvatarUrl: user.avatarUrl || '' };
  await Promise.all([
    Post.updateMany({ authorId: user.id }, { $set: author }),
    Comment.updateMany({ authorId: user.id }, { $set: author }),
    Endorsement.updateMany(
      { fromUserId: user.id },
      { $set: { 'from.name': user.name, 'from.username': user.username || '', 'from.avatarUrl': user.avatarUrl || '' } },
    ),
    Conversation.updateMany(
      { participantIds: user.id },
      { $set: { 'participants.$[p].name': user.name, 'participants.$[p].username': user.username || '', 'participants.$[p].avatarUrl': user.avatarUrl || '' } },
      { arrayFilters: [{ 'p.userId': user.id }] },
    ),
  ]);
  logger.info({ userId: user.id }, '[sso] author snapshots backfilled');
}

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
    mutedKeywords: u.mutedKeywords || [],
  };
}

module.exports = { router, publicUser };
