const express = require('express');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const { requireAuth } = require('../middleware/auth');
const { readLimiter, writeLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');

const router = express.Router();

// ── GET /api/notifications/badges ────────────────────────────────────────────
// ONE combined endpoint for every unread indicator: the community header polls
// it, and the MAIN APP's Community button fetches it (cross-subdomain, same
// site) to show a single count. Keeping it one cheap endpoint means both apps
// poll one thing instead of three.
router.get('/badges', readLimiter, requireAuth, async (req, res, next) => {
  try {
    const [notifications, convos] = await Promise.all([
      Notification.countDocuments({ userId: req.user.id, read: false }),
      Conversation.find({ participantIds: req.user.id }).sort({ updatedAt: -1 }).limit(50)
        .select('participants lastMessage status').lean(),
    ]);
    const messages = convos.filter((c) => {
      // A declined collab request is dismissed — it must not badge forever.
      if (c.status === 'declined') return false;
      if (!c.lastMessage?.createdAt || c.lastMessage.senderId === req.user.id) return false;
      const me = c.participants.find((p) => p.userId === req.user.id);
      return !me?.lastReadAt || new Date(me.lastReadAt) < new Date(c.lastMessage.createdAt);
    }).length;
    res.json({ notifications, messages, total: notifications + messages });
  } catch (err) { next(err); }
});

// ── GET /api/notifications ───────────────────────────────────────────────────
router.get('/', readLimiter, requireAuth, async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);
    const cursor = decodeIdCursor(req.query.cursor);
    const filter = { userId: req.user.id };
    if (cursor) filter._id = { $lt: cursor };
    const docs = await Notification.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const page = buildPage(docs, limit, (d) => d._id);
    res.json({
      items: page.items.map((n) => ({
        id: String(n._id),
        type: n.type,
        actor: n.actor,
        postId: n.postId ? String(n.postId) : null,
        snippet: n.snippet,
        read: n.read,
        createdAt: n.createdAt,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (err) { next(err); }
});

// ── POST /api/notifications/read-all ─────────────────────────────────────────
router.post('/read-all', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    await Notification.updateMany({ userId: req.user.id, read: false }, { $set: { read: true } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router };
