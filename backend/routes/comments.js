const express = require('express');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { writeLimiter, readLimiter, voteLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');
const { sanitizeHtml, sanitizeText, plainTextLength } = require('../utils/sanitize');
const { objectIdParams, isObjectId } = require('../middleware/objectId');
const { applyVote, votesForTargets } = require('../services/voting');
const { notify, resolveMentions } = require('../services/notify');

const router = express.Router();
const MAX_DEPTH = 8; // cap nesting so threads stay renderable

// 500 visible characters per comment (product decision), plus a raw-HTML
// ceiling so tag-stuffing can't sneak large payloads past the visible check.
const BODY_TEXT_MAX = 500;
const BODY_HTML_MAX = 5000;

// ── GET /api/comments?postId=&sort=top|new ───────────────────────────────────
// Loads a page of a post's comments as a FLAT list (with path/depth) so the
// client assembles the tree. One indexed range query — no recursion, no N+1.
// Removed comments ARE included (as body-less placeholders) so replies keep
// their thread position instead of orphaning to the top level.
router.get('/', readLimiter, optionalAuth, async (req, res, next) => {
  try {
    const { postId } = req.query;
    if (!isObjectId(postId)) return res.status(400).json({ error: 'postId required' });
    const sort = req.query.sort === 'top' ? 'top' : 'new';
    const limit = clampLimit(req.query.limit);
    const cursor = decodeIdCursor(req.query.cursor);

    const filter = { postId };
    let query;
    if (sort === 'top') {
      // Cursor for a mutable sort key: anchor on the cursor doc's confidence,
      // tie-broken by _id — same pattern as the hot feed.
      if (cursor) {
        const anchor = await Comment.findById(cursor).select('confidence').lean();
        if (anchor) {
          filter.$or = [
            { confidence: { $lt: anchor.confidence } },
            { confidence: anchor.confidence, _id: { $lt: cursor } },
          ];
        }
      }
      query = Comment.find(filter).sort({ confidence: -1, _id: -1 });
    } else {
      if (cursor) filter._id = { $lt: cursor };
      query = Comment.find(filter).sort({ _id: -1 });
    }

    const docs = await query.limit(limit + 1).lean();
    const page = buildPage(docs, limit, (d) => d._id);
    const myVotes = await votesForTargets(req.user?.id, 'comment', page.items.map((c) => c._id));
    const items = page.items.map((c) => shapeComment(c, myVotes.get(String(c._id)) || 0));

    res.json({ items, nextCursor: page.nextCursor, hasMore: page.hasMore });
  } catch (err) { next(err); }
});

// ── POST /api/comments ───────────────────────────────────────────────────────
router.post('/', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const { postId, parentId, body } = req.body || {};
    if (!isObjectId(postId)) return res.status(404).json({ error: 'Post not found' });
    if (parentId != null && !isObjectId(parentId)) return res.status(404).json({ error: 'Parent comment not found' });
    if (typeof body === 'string' && (body.length > BODY_HTML_MAX || plainTextLength(body) > BODY_TEXT_MAX)) {
      return res.status(400).json({ error: `Comment is too long (max ${BODY_TEXT_MAX} characters)` });
    }
    const clean = sanitizeHtml(body);
    if (!clean) return res.status(400).json({ error: 'Comment cannot be empty' });

    const post = await Post.findOne({ _id: postId, status: 'active' }).select('_id authorId');
    if (!post) return res.status(404).json({ error: 'Post not found' });

    let path = [];
    let depth = 0;
    let parentAuthorId = null;
    if (parentId) {
      const parent = await Comment.findOne({ _id: parentId, postId, status: 'active' }).select('path depth authorId');
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
      depth = Math.min(parent.depth + 1, MAX_DEPTH);
      path = [...parent.path, parent._id];
      parentAuthorId = parent.authorId;
    }

    const comment = await Comment.create({
      postId,
      parentId: parentId || null,
      path,
      depth,
      authorId: req.user.id,
      authorName: req.user.name,
      authorUsername: req.user.username || '',
      authorAvatarUrl: req.user.avatarUrl || '',
      body: clean,
    });

    // Denormalized counters via $inc — never recounted at read time.
    await Post.updateOne({ _id: postId }, { $inc: { commentCount: 1 } });
    if (parentId) await Comment.updateOne({ _id: parentId }, { $inc: { replyCount: 1 } });

    // ── Notifications: mention > reply > comment, one per person, never self ──
    // Awaited (not fire-and-forget): on serverless the function can freeze the
    // moment the response is sent, silently losing unawaited writes. notify()
    // swallows its own errors, so this can't fail the comment.
    const snippet = sanitizeText(clean, 120);
    const actor = { id: req.user.id, name: req.user.name, username: req.user.username, avatarUrl: req.user.avatarUrl };
    const notified = new Set([req.user.id]);
    const base = { actor, postId: post._id, commentId: comment._id, snippet };
    const jobs = [];
    for (const m of await resolveMentions(snippet)) {
      if (!notified.has(m.id)) { notified.add(m.id); jobs.push(notify({ userId: m.id, type: 'mention', ...base })); }
    }
    if (parentAuthorId && !notified.has(parentAuthorId)) {
      notified.add(parentAuthorId);
      jobs.push(notify({ userId: parentAuthorId, type: 'reply', ...base }));
    }
    if (post.authorId && !notified.has(post.authorId)) {
      notified.add(post.authorId);
      jobs.push(notify({ userId: post.authorId, type: 'comment', ...base }));
    }
    await Promise.all(jobs);

    res.status(201).json({ comment: shapeComment(comment.toObject(), 0) });
  } catch (err) { next(err); }
});

// ── DELETE /api/comments/:id ─────────────────────────────────────────────────
router.delete('/:id', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment || comment.status === 'removed') return res.status(404).json({ error: 'Comment not found' });
    const isOwner = comment.authorId === req.user.id;
    if (!isOwner && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
    comment.status = 'removed';
    comment.body = '';
    await comment.save();
    await Post.updateOne({ _id: comment.postId }, { $inc: { commentCount: -1 } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/comments/:id/vote ──────────────────────────────────────────────
router.post('/:id/vote', voteLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const value = Number(req.body?.value);
    const result = await applyVote({ userId: req.user.id, targetType: 'comment', targetId: req.params.id, value });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

function shapeComment(c, myVote) {
  // Removed comments go out as anonymous placeholders: the reply structure
  // stays intact for the thread, but body and author identity are withheld.
  const removed = c.status === 'removed';
  return {
    id: String(c._id),
    postId: String(c.postId),
    parentId: c.parentId ? String(c.parentId) : null,
    depth: c.depth || 0,
    body: removed ? '' : c.body,
    author: removed
      ? { id: '', name: '', username: '', avatarUrl: '' }
      : { id: c.authorId, name: c.authorName, username: c.authorUsername, avatarUrl: c.authorAvatarUrl },
    score: removed ? 0 : (c.score || 0),
    replyCount: c.replyCount || 0,
    myVote: removed ? 0 : (myVote || 0),
    status: c.status,
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
  };
}

module.exports = { router, shapeComment };
