const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const Endorsement = require('../models/Endorsement');
const Conversation = require('../models/Conversation');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { readLimiter, writeLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');
const { sanitizeText } = require('../utils/sanitize');
const { votesForTargets } = require('../services/voting');
const { savesForTargets } = require('../services/saves');
const { normalizeTopic } = require('../config/topics');
const { shapePost } = require('./posts');

const router = express.Router();

// ── PATCH /api/users/me/topics — toggle a followed topic (For-you feed) ───────
router.patch('/me/topics', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const topic = normalizeTopic(req.body?.topic);
    if (!topic) return res.status(400).json({ error: 'Invalid topic' });
    const following = (req.user.followedTopics || []).includes(topic);
    const update = following
      ? { $pull: { followedTopics: topic } }
      : { $addToSet: { followedTopics: topic } };
    if (!following && (req.user.followedTopics || []).length >= 20) {
      return res.status(400).json({ error: 'You can follow up to 20 topics' });
    }
    const user = await User.findOneAndUpdate({ id: req.user.id }, update, { new: true }).lean();
    res.json({ followedTopics: user.followedTopics || [] });
  } catch (err) { next(err); }
});

// ── POST /api/users/:id/block — toggle a DM block ────────────────────────────
// Mindful scope: blocking stops NEW conversations and messages between the two
// of you (both directions). It does not hide their public posts.
router.post('/:id/block', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const targetId = String(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot block yourself' });
    const target = await User.findOne({ id: targetId }).select('id').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });
    const blocked = (req.user.blocked || []).includes(targetId);
    if (!blocked && (req.user.blocked || []).length >= 500) {
      return res.status(400).json({ error: 'Block list is full' });
    }
    await User.updateOne(
      { id: req.user.id },
      blocked ? { $pull: { blocked: targetId } } : { $addToSet: { blocked: targetId } },
    );
    res.json({ blocked: !blocked });
  } catch (err) { next(err); }
});

// ── POST /api/users/:id/endorse — "we worked together" ───────────────────────
// Gated on having a DM conversation with the person (proxy for a real
// interaction) and one endorsement per pair (upserted, so it's editable).
router.post('/:id/endorse', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const targetId = String(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot endorse yourself' });
    const target = await User.findOne({ id: targetId }).select('id').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });

    const pairKey = Conversation.pairKeyFor(req.user.id, targetId);
    const worked = await Conversation.findOne({ pairKey }).select('_id').lean();
    if (!worked) {
      return res.status(403).json({ error: 'You can only endorse people you have talked with. Message them first.' });
    }

    const endorsement = await Endorsement.findOneAndUpdate(
      { fromUserId: req.user.id, toUserId: targetId },
      {
        $set: {
          from: { name: req.user.name, username: req.user.username || '', avatarUrl: req.user.avatarUrl || '' },
          skill: sanitizeText(req.body?.skill, 40),
          text: sanitizeText(req.body?.text, 140),
        },
        $setOnInsert: { fromUserId: req.user.id, toUserId: targetId, createdAt: new Date() },
      },
      { upsert: true, new: true },
    ).lean();
    res.status(201).json({ endorsement: shapeEndorsement(endorsement) });
  } catch (err) { next(err); }
});

// ── GET /api/users/:handle — public profile + their posts ────────────────────
// Looks up by username first, then falls back to the user id — main-app
// usernames are optional, so username-less users stay reachable via /u/<id>.
router.get('/:handle', readLimiter, optionalAuth, async (req, res, next) => {
  try {
    const handle = String(req.params.handle);
    let user = await User.findOne({ username: handle.toLowerCase() }).lean();
    if (!user) user = await User.findOne({ id: handle }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const limit = clampLimit(req.query.limit);
    const cursor = decodeIdCursor(req.query.cursor);
    const filter = { authorId: user.id, status: 'active' };
    if (cursor) filter._id = { $lt: cursor };
    const [docs, endorsements, endorsementCount] = await Promise.all([
      Post.find(filter).sort({ _id: -1 }).limit(limit + 1).lean(),
      Endorsement.find({ toUserId: user.id }).sort({ _id: -1 }).limit(10).lean(),
      Endorsement.countDocuments({ toUserId: user.id }),
    ]);
    const page = buildPage(docs, limit, (d) => d._id);
    const ids = page.items.map((p) => p._id);
    const [myVotes, mySaves] = await Promise.all([
      votesForTargets(req.user?.id, 'post', ids),
      savesForTargets(req.user?.id, ids),
    ]);

    res.json({
      profile: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatarUrl: user.avatarUrl || '',
        bio: user.bio || '',
        skills: user.skills || [],
        karma: user.karma || 0,
        postCount: user.postCount || 0,
        createdAt: user.createdAt,
        endorsementCount,
        // Viewer-relative flags (absent for guests).
        isBlocked: req.user ? (req.user.blocked || []).includes(user.id) : false,
      },
      endorsements: endorsements.map(shapeEndorsement),
      posts: page.items.map((p) => shapePost(p, myVotes.get(String(p._id)) || 0, mySaves.has(String(p._id)))),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/users/me — edit community-local profile fields ────────────────
router.patch('/me/profile', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const { bio, skills, mutedKeywords } = req.body || {};
    const update = {};
    if (bio !== undefined) update.bio = sanitizeText(bio, 280);
    if (Array.isArray(skills)) update.skills = skills.map((s) => sanitizeText(s, 40)).filter(Boolean).slice(0, 15);
    if (Array.isArray(mutedKeywords)) {
      // Lowercased + deduped; matching in the feed is case-insensitive anyway,
      // and lowercase keeps the list readable in the UI.
      update.mutedKeywords = [...new Set(
        mutedKeywords.map((k) => sanitizeText(k, 40).toLowerCase()).filter(Boolean),
      )].slice(0, 30);
    }
    const user = await User.findOneAndUpdate({ id: req.user.id }, { $set: update }, { new: true }).lean();
    res.json({ profile: { id: user.id, bio: user.bio, skills: user.skills, mutedKeywords: user.mutedKeywords || [] } });
  } catch (err) { next(err); }
});

function shapeEndorsement(e) {
  return {
    id: String(e._id),
    from: { id: e.fromUserId, name: e.from?.name || '', username: e.from?.username || '', avatarUrl: e.from?.avatarUrl || '' },
    skill: e.skill || '',
    text: e.text || '',
    createdAt: e.createdAt,
  };
}

module.exports = { router };
