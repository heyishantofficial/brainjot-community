const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');
const { sanitizeText } = require('../utils/sanitize');
const { objectIdParams, isObjectId } = require('../middleware/objectId');

const router = express.Router();

// ── GET /api/conversations ───────────────────────────────────────────────────
// The inbox: my conversations, most recently active first, with unread flags.
router.get('/', readLimiter, requireAuth, async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);
    const filter = { participantIds: req.user.id };
    if (req.query.cursor) {
      const before = new Date(Number(req.query.cursor));
      if (!isNaN(before)) filter.updatedAt = { $lt: before };
    }
    const docs = await Conversation.find(filter).sort({ updatedAt: -1 }).limit(limit + 1).lean();
    const page = buildPage(docs, limit, (d) => d.updatedAt.getTime());
    res.json({
      items: page.items.map((c) => shapeConversation(c, req.user.id)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (err) { next(err); }
});

// ── POST /api/conversations ──────────────────────────────────────────────────
// Find-or-create the 1:1 thread with another user. The unique pairKey + upsert
// make this atomic, so two people opening a chat simultaneously can't create
// duplicate threads. This is the entry point from a collab post's "Message".
router.post('/', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const { userId, originPostId } = req.body || {};
    if (!userId || userId === req.user.id) return res.status(400).json({ error: 'Invalid recipient' });

    const other = await User.findOne({ id: userId }).lean();
    if (!other) return res.status(404).json({ error: 'User not found' });
    // Blocks work both ways; the blocked party gets a neutral message that
    // doesn't confirm they were blocked.
    if ((other.blocked || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'This user is not accepting messages' });
    }
    if ((req.user.blocked || []).includes(userId)) {
      return res.status(403).json({ error: 'You have blocked this user. Unblock them to start a conversation.' });
    }

    const pairKey = Conversation.pairKeyFor(req.user.id, userId);
    const now = new Date();
    const convo = await Conversation.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: {
          pairKey,
          participantIds: [req.user.id, userId].sort(),
          participants: [snap(req.user), snap(other)],
          // Validated: a garbage originPostId would CastError at insert (500).
          originPostId: isObjectId(originPostId) ? originPostId : null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.status(201).json({ conversation: shapeConversation(convo, req.user.id) });
  } catch (err) { next(err); }
});

// ── GET /api/conversations/:id/messages ──────────────────────────────────────
router.get('/:id/messages', readLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const convo = await Conversation.findById(req.params.id).lean();
    if (!convo || !convo.participantIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // ── Polling mode: ?after=<messageId> ─────────────────────────────────
    // Returns only messages newer than the client's last one, oldest→newest.
    // Each poll is a cheap indexed `_id > after` seek that usually returns zero
    // rows — so polling every couple of seconds is near-free per request.
    if (req.query.after && mongoose.Types.ObjectId.isValid(req.query.after)) {
      const after = new mongoose.Types.ObjectId(req.query.after);
      const fresh = await Message.find({ conversationId: convo._id, _id: { $gt: after } })
        .sort({ _id: 1 }).limit(100).lean();
      return res.json({ items: fresh.map(shapeMessage), nextCursor: null, hasMore: false });
    }

    // ── History mode: cursor pagination (load older pages) ──────────────
    const limit = clampLimit(req.query.limit);
    const cursor = decodeIdCursor(req.query.cursor);
    const filter = { conversationId: convo._id };
    if (cursor) filter._id = { $lt: cursor };
    const docs = await Message.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const page = buildPage(docs, limit, (d) => d._id);
    res.json({
      items: page.items.map(shapeMessage).reverse(), // oldest→newest for display
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (err) { next(err); }
});

// ── POST /api/conversations/:id/messages ─────────────────────────────────────
router.post('/:id/messages', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo || !convo.participantIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const body = sanitizeText(req.body?.body, 4000);
    if (!body) return res.status(400).json({ error: 'Message cannot be empty' });

    // Block enforcement on existing threads, both directions.
    const otherId = convo.participantIds.find((p) => p !== req.user.id);
    if ((req.user.blocked || []).includes(otherId)) {
      return res.status(403).json({ error: 'You have blocked this user' });
    }
    const other = await User.findOne({ id: otherId }).select('blocked').lean();
    if (other && (other.blocked || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'This user is not accepting messages' });
    }

    const message = await Message.create({
      conversationId: convo._id,
      senderId: req.user.id,
      body,
      readBy: [req.user.id],
    });

    // Update the conversation's denormalized last-message preview + activity time.
    convo.lastMessage = { text: body.slice(0, 140), senderId: req.user.id, createdAt: message.createdAt };
    convo.updatedAt = message.createdAt;
    await convo.save();

    // Recipients pick this up on their next poll (no socket push on serverless).
    res.status(201).json({ message: shapeMessage(message.toObject()) });
  } catch (err) { next(err); }
});

// ── POST /api/conversations/:id/read ─────────────────────────────────────────
router.post('/:id/read', readLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    await Conversation.updateOne(
      { _id: req.params.id, 'participants.userId': req.user.id },
      { $set: { 'participants.$.lastReadAt': new Date() } },
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── shaping ──────────────────────────────────────────────────────────────────
function snap(u) {
  return { userId: u.id, name: u.name, username: u.username || '', avatarUrl: u.avatarUrl || '', lastReadAt: null };
}

function shapeConversation(c, meId) {
  const me = c.participants.find((p) => p.userId === meId);
  const other = c.participants.find((p) => p.userId !== meId) || c.participants[0];
  const unread = !!(c.lastMessage?.createdAt && c.lastMessage.senderId !== meId &&
    (!me?.lastReadAt || new Date(me.lastReadAt) < new Date(c.lastMessage.createdAt)));
  return {
    id: String(c._id),
    other: other ? { id: other.userId, name: other.name, username: other.username, avatarUrl: other.avatarUrl } : null,
    lastMessage: c.lastMessage || null,
    originPostId: c.originPostId ? String(c.originPostId) : null,
    unread,
    updatedAt: c.updatedAt,
  };
}

function shapeMessage(m) {
  return {
    id: String(m._id),
    conversationId: String(m.conversationId),
    senderId: m.senderId,
    body: m.body,
    attachments: m.attachments || [],
    createdAt: m.createdAt,
  };
}

module.exports = { router };
