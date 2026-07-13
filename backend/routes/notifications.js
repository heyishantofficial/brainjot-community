const express = require('express');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const PushSubscription = require('../models/PushSubscription');
const { pushEnabled, VAPID_PUBLIC_KEY } = require('../services/push');
const { requireAuth } = require('../middleware/auth');
const { readLimiter, writeLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');

const router = express.Router();

// ── GET /api/notifications/push/key ──────────────────────────────────────────
// VAPID public key for pushManager.subscribe(); null → push disabled on server.
router.get('/push/key', readLimiter, requireAuth, (_req, res) => {
  res.json({ key: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

// ── POST /api/notifications/push/subscribe ───────────────────────────────────
// Store/refresh this browser's push subscription. Upsert on endpoint: a
// re-subscribe (or a different user on the same browser) takes it over.
router.post('/push/subscribe', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024 || !/^https:\/\//.test(sub.endpoint)) {
      return res.status(400).json({ error: 'Invalid endpoint' });
    }
    const count = await PushSubscription.countDocuments({ userId: req.user.id });
    const exists = await PushSubscription.findOne({ endpoint: sub.endpoint }).select('_id').lean();
    if (!exists && count >= 10) return res.status(429).json({ error: 'Too many devices subscribed' });
    await PushSubscription.updateOne(
      { endpoint: sub.endpoint },
      { $set: { userId: req.user.id, keys: { p256dh: String(sub.keys.p256dh).slice(0, 256), auth: String(sub.keys.auth).slice(0, 256) }, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/notifications/push/unsubscribe ─────────────────────────────────
router.post('/push/unsubscribe', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) await PushSubscription.deleteOne({ endpoint: String(endpoint), userId: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

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
        conversationId: n.conversationId ? String(n.conversationId) : null,
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
