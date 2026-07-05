const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Post = require('../models/Post');
const { notify } = require('../services/notify');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');
const { sanitizeText } = require('../utils/sanitize');
const { objectIdParams, isObjectId } = require('../middleware/objectId');

const router = express.Router();

// ── GET /api/conversations ───────────────────────────────────────────────────
// The inbox: my conversations, most recently active first, with unread flags.
// `?tab=dms|collab` splits normal DMs from collab-request threads so pitches
// never bury real conversations. Docs from before the `kind` field existed are
// classified by whether they were started from a collab post (originPostId).
router.get('/', readLimiter, requireAuth, async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);
    const filter = { participantIds: req.user.id };
    if (req.query.cursor) {
      const before = new Date(Number(req.query.cursor));
      if (!isNaN(before)) filter.updatedAt = { $lt: before };
    }
    if (req.query.tab === 'dms') {
      filter.$or = [{ kind: 'dm' }, { kind: { $exists: false }, originPostId: null }];
    } else if (req.query.tab === 'collab') {
      filter.$and = [
        { $or: [{ kind: 'collab' }, { kind: { $exists: false }, originPostId: { $ne: null } }] },
        // A declined request disappears for the recipient; the requester still
        // sees it (shaped as pending — declines are never revealed).
        { $or: [{ status: { $ne: 'declined' } }, { requesterId: req.user.id }] },
      ];
    }
    const [docs, requestCount] = await Promise.all([
      Conversation.find(filter).sort({ updatedAt: -1 }).limit(limit + 1)
        .populate({ path: 'originPostId', select: 'title' }).lean(),
      // Pending requests waiting on ME — the badge on the Collab Requests tab.
      Conversation.countDocuments({
        participantIds: req.user.id, kind: 'collab', status: 'pending', requesterId: { $ne: req.user.id },
      }),
    ]);
    const page = buildPage(docs, limit, (d) => d.updatedAt.getTime());
    res.json({
      items: page.items.map((c) => shapeConversation(c, req.user.id)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      requestCount,
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
    // A chat opened from a collab post is a collab REQUEST: it routes to the
    // recipient's Collab Requests tab and stays pending (intro message only)
    // until they accept. A chat opened from a profile is a plain DM. If the
    // pair already has a thread, $setOnInsert leaves it untouched.
    const fromCollabPost = isObjectId(originPostId);
    const convo = await Conversation.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: {
          pairKey,
          participantIds: [req.user.id, userId].sort(),
          participants: [snap(req.user), snap(other)],
          // Validated: a garbage originPostId would CastError at insert (500).
          originPostId: fromCollabPost ? originPostId : null,
          kind: fromCollabPost ? 'collab' : 'dm',
          status: fromCollabPost ? 'pending' : 'active',
          requesterId: fromCollabPost ? req.user.id : '',
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.status(201).json({ conversation: shapeConversation(convo, req.user.id) });
  } catch (err) { next(err); }
});

// ── GET /api/conversations/:id ───────────────────────────────────────────────
// One conversation, shaped for the viewer — lets a deep link (/messages/:id)
// resolve the thread's peer, tab, and request state without loading the inbox.
router.get('/:id', readLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const convo = await Conversation.findById(req.params.id)
      .populate({ path: 'originPostId', select: 'title' }).lean();
    if (!convo || !convo.participantIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ conversation: shapeConversation(convo, req.user.id) });
  } catch (err) { next(err); }
});

// ── POST /api/conversations/:id/request ──────────────────────────────────────
// Accept or decline a pending collab request. Recipient only. Accepting opens
// the thread for normal messaging; declining hides it from the recipient
// (silently — the requester keeps seeing "pending"). A declined request can
// still be accepted later if the recipient changes their mind.
router.post('/:id/request', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const { action } = req.body || {};
    if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const convo = await Conversation.findById(req.params.id);
    if (!convo || !convo.participantIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    if (convo.requesterId === req.user.id) {
      return res.status(403).json({ error: 'Only the recipient can respond to a request' });
    }
    const canRespond = convo.status === 'pending' || (convo.status === 'declined' && action === 'accept');
    if (convo.kind !== 'collab' || !canRespond) {
      return res.status(400).json({ error: 'No pending request on this conversation' });
    }

    convo.status = action === 'accept' ? 'active' : 'declined';
    await convo.save();

    // Tell the requester their pitch was accepted (declines are never revealed).
    if (action === 'accept') {
      await notify({ userId: convo.requesterId, type: 'collab_accepted', actor: req.user, postId: convo.originPostId, conversationId: convo._id });
    }
    res.json({ conversation: shapeConversation(convo.toObject(), req.user.id) });
  } catch (err) { next(err); }
});

// ── GET /api/conversations/:id/messages ──────────────────────────────────────
router.get('/:id/messages', readLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const convo = await Conversation.findById(req.params.id).lean();
    if (!convo || !convo.participantIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // The other participant's read cursor — drives the sent/read ticks on my own
    // messages. Returned on EVERY messages response (even an empty poll) so the
    // sender's ticks flip to "read" on the next poll after the peer opens the chat.
    const peer = convo.participants.find((p) => p.userId !== req.user.id);
    const peerLastReadAt = peer?.lastReadAt || null;

    // ── Polling mode: ?after=<messageId> ─────────────────────────────────
    // Returns only messages newer than the client's last one, oldest→newest.
    // Each poll is a cheap indexed `_id > after` seek that usually returns zero
    // rows — so polling every couple of seconds is near-free per request.
    if (req.query.after && mongoose.Types.ObjectId.isValid(req.query.after)) {
      const after = new mongoose.Types.ObjectId(req.query.after);
      const fresh = await Message.find({ conversationId: convo._id, _id: { $gt: after } })
        .sort({ _id: 1 }).limit(100).lean();
      return res.json({ items: fresh.map(shapeMessage), nextCursor: null, hasMore: false, peerLastReadAt });
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
      peerLastReadAt,
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

    // Collab-request gate. While a request is pending (or was declined — never
    // revealed), the requester gets exactly ONE intro message; anything more
    // waits for the recipient. The recipient replying is an implicit accept,
    // which also reopens a declined thread. We note who to notify and fire it
    // AFTER the message is saved (so a notify failure can't lose the message).
    let notifyRequestTo = null;   // poster to notify: a collab request landed
    let notifyAcceptedTo = null;  // requester to notify: their request was accepted
    if (convo.kind === 'collab' && convo.status !== 'active') {
      if (convo.requesterId === req.user.id) {
        const alreadyPitched = await Message.exists({ conversationId: convo._id, senderId: req.user.id });
        if (convo.status === 'declined' || alreadyPitched) {
          return res.status(403).json({ error: 'Your collab request is waiting for a response — you can send more messages once they reply or accept.' });
        }
        notifyRequestTo = otherId; // this is the requester's first pitch message
      } else {
        convo.status = 'active';    // recipient replying = implicit accept
        notifyAcceptedTo = convo.requesterId;
      }
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

    // Collab notifications (awaited — serverless can freeze after the response).
    if (notifyRequestTo) {
      const post = convo.originPostId ? await Post.findById(convo.originPostId).select('title').lean() : null;
      await notify({ userId: notifyRequestTo, type: 'collab_request', actor: req.user, postId: convo.originPostId, conversationId: convo._id, snippet: post?.title || '' });
    }
    if (notifyAcceptedTo) {
      await notify({ userId: notifyAcceptedTo, type: 'collab_accepted', actor: req.user, postId: convo.originPostId, conversationId: convo._id });
    }

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
  // originPostId may be populated ({_id, title}) or a raw ObjectId.
  const op = c.originPostId;
  const originPostId = op ? String(op._id || op) : null;
  // Legacy docs (pre-`kind`) classify by origin and were never gated.
  const kind = c.kind || (originPostId ? 'collab' : 'dm');
  let status = c.status || 'active';
  const isRequester = !!c.requesterId && c.requesterId === meId;
  if (status === 'declined' && isRequester) status = 'pending'; // never reveal a decline
  return {
    id: String(c._id),
    other: other ? { id: other.userId, name: other.name, username: other.username, avatarUrl: other.avatarUrl } : null,
    lastMessage: c.lastMessage || null,
    originPostId,
    originPost: op && op.title ? { id: originPostId, title: op.title } : null,
    kind,
    status,
    isRequester,
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
