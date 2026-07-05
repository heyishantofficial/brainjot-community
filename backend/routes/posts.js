const express = require('express');
const Post = require('../models/Post');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { writeLimiter, readLimiter, voteLimiter } = require('../middleware/rateLimit');
const { clampLimit, decodeIdCursor, buildPage } = require('../utils/cursor');
const { sanitizeHtml, sanitizeText, plainTextLength } = require('../utils/sanitize');
const { objectIdParams } = require('../middleware/objectId');
const { hotScore, diversifyByAuthor } = require('../utils/score');
const { applyVote, votesForTargets } = require('../services/voting');
const { savesForTargets } = require('../services/saves');
const { interestsForTargets } = require('../services/interests');
const { notify } = require('../services/notify');
const SavedPost = require('../models/SavedPost');
const Interest = require('../models/Interest');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { TOPICS, normalizeTopic } = require('../config/topics');
const { uid } = require('../utils/ids');
const logger = require('../utils/logger');

const router = express.Router();

// Length limits for the post body: 500 visible characters (product decision —
// short, X-style posts), plus a hard ceiling on raw HTML size so tag-stuffing
// can't sneak megabytes past the visible-length check or into the sanitizer.
const BODY_TEXT_MAX = 500;
const BODY_HTML_MAX = 5000;

function bodyTooLong(body) {
  if (typeof body !== 'string') return false;
  return body.length > BODY_HTML_MAX || plainTextLength(body) > BODY_TEXT_MAX;
}

// Escape user text for safe embedding in a RegExp (muted keywords).
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── GET /api/posts/topics ────────────────────────────────────────────────────
router.get('/topics', (_req, res) => res.json({ topics: TOPICS }));

// ── GET /api/posts/search?q= ─────────────────────────────────────────────────
// Text search over title/topics/collab fields via the weighted text index.
// Top 30 by relevance — no deep pagination; if it's not in the first 30,
// refine the query. (Defined before /:id so "search" isn't parsed as an id.)
router.get('/search', readLimiter, optionalAuth, async (req, res, next) => {
  try {
    const q = sanitizeText(req.query.q, 100);
    if (!q) return res.json({ items: [] });
    const docs = await Post.find(
      { $text: { $search: q }, status: 'active' },
      { score: { $meta: 'textScore' } },
    ).sort({ score: { $meta: 'textScore' } }).limit(30).lean();
    const ids = docs.map((p) => p._id);
    const [myVotes, mySaves, myInterests] = await Promise.all([
      votesForTargets(req.user?.id, 'post', ids),
      savesForTargets(req.user?.id, ids),
      interestsForTargets(req.user?.id, ids),
    ]);
    res.json({ items: docs.map((p) => shapePost(p, myVotes.get(String(p._id)) || 0, mySaves.has(String(p._id)), myInterests.has(String(p._id)))) });
  } catch (err) { next(err); }
});

// ── GET /api/posts/saved — the viewer's bookmarks, most recently saved first ──
router.get('/saved', readLimiter, requireAuth, async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);
    const cursor = decodeIdCursor(req.query.cursor);
    const filter = { userId: req.user.id };
    if (cursor) filter._id = { $lt: cursor };
    const saves = await SavedPost.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const page = buildPage(saves, limit, (d) => d._id);
    const posts = await Post.find({ _id: { $in: page.items.map((s) => s.postId) }, status: 'active' }).lean();
    const byId = new Map(posts.map((p) => [String(p._id), p]));
    const ordered = page.items.map((s) => byId.get(String(s.postId))).filter(Boolean);
    const [myVotes, myInterests] = await Promise.all([
      votesForTargets(req.user.id, 'post', ordered.map((p) => p._id)),
      interestsForTargets(req.user.id, ordered.map((p) => p._id)),
    ]);
    res.json({
      items: ordered.map((p) => shapePost(p, myVotes.get(String(p._id)) || 0, true, myInterests.has(String(p._id)))),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (err) { next(err); }
});

// ── GET /api/posts ───────────────────────────────────────────────────────────
// The feed. sort=hot|new, optional topic / type filters, cursor pagination.
// Hot sort walks the {status,hotScore,_id} index; new sort walks {status,_id}.
// Either way it's an index seek, not a collection scan — that's what survives
// millions of rows.
router.get('/', readLimiter, optionalAuth, async (req, res, next) => {
  try {
    const sort = req.query.sort === 'new' ? 'new' : 'hot';
    const limit = clampLimit(req.query.limit);
    const cursor = decodeIdCursor(req.query.cursor);

    const filter = { status: 'active' };
    // "For you": restrict to the viewer's followed topics (empty follows = empty feed;
    // the frontend only shows this tab once the user follows something).
    if (req.query.feed === 'foryou' && req.user) {
      const followed = req.user.followedTopics || [];
      if (!followed.length) return res.json({ items: [], nextCursor: null, hasMore: false });
      filter.topics = { $in: followed };
    }
    // Muted keywords (X's muted_keyword_filter): posts whose title or body
    // contain a phrase the viewer muted never reach their feed. One combined,
    // escaped, case-insensitive alternation — checked during the index walk.
    const muted = (req.user?.mutedKeywords || []).filter(Boolean);
    if (muted.length) {
      const rx = new RegExp(muted.map(escapeRegex).join('|'), 'i');
      filter.$nor = [{ title: rx }, { body: rx }];
    }
    if (req.query.topic) filter.topics = normalizeTopic(req.query.topic);
    if (req.query.type && ['discussion', 'showcase', 'question', 'collab'].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    // Collab board filters — only meaningful when browsing collab posts. Uses the
    // {type, collab.status, _id} index so the board stays an index seek at scale.
    if (filter.type === 'collab') {
      const cStatus = req.query.collabStatus;
      filter['collab.status'] = cStatus === 'closed' ? 'closed' : 'open'; // default to open roles
      if (req.query.intent === 'looking_for' || req.query.intent === 'offering') {
        filter['collab.intent'] = req.query.intent;
      }
      if (['full_time', 'part_time', 'one_off', 'flexible'].includes(req.query.commitment)) {
        filter['collab.commitment'] = req.query.commitment;
      }
      if (req.query.skill) filter['collab.skills'] = normalizeTopic(req.query.skill);
      if (req.query.remote === 'true') filter['collab.remote'] = true;
    }

    let query;
    if (sort === 'hot') {
      // For "hot" we can't cursor on a single mutable field cleanly, so we page
      // by hotScore with _id as the stable tie-breaker. The cursor encodes _id;
      // we fetch the cursor doc's hotScore to continue precisely.
      if (cursor) {
        const anchor = await Post.findById(cursor).select('hotScore').lean();
        if (anchor) {
          filter.$or = [
            { hotScore: { $lt: anchor.hotScore } },
            { hotScore: anchor.hotScore, _id: { $lt: cursor } },
          ];
        }
      }
      query = Post.find(filter).sort({ hotScore: -1, _id: -1 });
    } else {
      if (cursor) filter._id = { $lt: cursor };
      query = Post.find(filter).sort({ _id: -1 });
    }

    const docs = await query.limit(limit + 1).lean();
    const page = buildPage(docs, limit, (d) => d._id);

    // Author diversity: reorder WITHIN the page so one author's posting spree
    // doesn't fill the screen. Runs after buildPage — the cursor still encodes
    // the raw index order, so pagination never skips or repeats a post.
    if (sort === 'hot') page.items = diversifyByAuthor(page.items);

    // Attach the viewer's vote + saved state in TWO queries, not 2N.
    const ids = page.items.map((p) => p._id);
    const [myVotes, mySaves, myInterests] = await Promise.all([
      votesForTargets(req.user?.id, 'post', ids),
      savesForTargets(req.user?.id, ids),
      interestsForTargets(req.user?.id, ids),
    ]);
    const items = page.items.map((p) => shapePost(p, myVotes.get(String(p._id)) || 0, mySaves.has(String(p._id)), myInterests.has(String(p._id))));

    res.json({ items, nextCursor: page.nextCursor, hasMore: page.hasMore });
  } catch (err) { next(err); }
});

// ── POST /api/posts ──────────────────────────────────────────────────────────
router.post('/', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const { type = 'discussion', title, body = '', media = [], topics = [], collab } = req.body || {};
    const cleanTitle = sanitizeText(title, 300);
    if (!cleanTitle) return res.status(400).json({ error: 'Title is required' });
    if (bodyTooLong(body)) return res.status(400).json({ error: `Post is too long (max ${BODY_TEXT_MAX} characters)` });
    if (!['discussion', 'showcase', 'question', 'collab'].includes(type)) {
      return res.status(400).json({ error: 'Invalid post type' });
    }

    const now = new Date();
    const doc = {
      authorId: req.user.id,
      authorName: req.user.name,
      authorUsername: req.user.username || '',
      authorAvatarUrl: req.user.avatarUrl || '',
      type,
      title: cleanTitle,
      body: sanitizeHtml(body),
      media: sanitizeMedia(media),
      topics: normalizeTopics(topics),
      createdAt: now,
      // Seed hotScore so brand-new posts sort sensibly before any engagement.
      hotScore: hotScore({ createdAt: now }),
    };

    if (type === 'collab') doc.collab = shapeCollabInput(collab);

    const post = await Post.create(doc);
    await require('../models/User').updateOne({ id: req.user.id }, { $inc: { postCount: 1 } });

    res.status(201).json({ post: shapePost(post.toObject(), 0) });
  } catch (err) { next(err); }
});

// ── GET /api/posts/:id ───────────────────────────────────────────────────────
router.get('/:id', readLimiter, objectIdParams('id'), optionalAuth, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, status: 'active' }).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const [myVotes, mySaves, myInterests] = await Promise.all([
      votesForTargets(req.user?.id, 'post', [post._id]),
      savesForTargets(req.user?.id, [post._id]),
      interestsForTargets(req.user?.id, [post._id]),
    ]);
    res.json({ post: shapePost(post, myVotes.get(String(post._id)) || 0, mySaves.has(String(post._id)), myInterests.has(String(post._id))) });
  } catch (err) { next(err); }
});

// ── PATCH /api/posts/:id ─────────────────────────────────────────────────────
router.patch('/:id', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || post.status === 'removed') return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== req.user.id) return res.status(403).json({ error: 'Not your post' });

    const { title, body, topics, collab } = req.body || {};
    if (bodyTooLong(body)) return res.status(400).json({ error: `Post is too long (max ${BODY_TEXT_MAX} characters)` });
    if (title !== undefined) post.title = sanitizeText(title, 300) || post.title;
    if (body !== undefined) post.body = sanitizeHtml(body);
    if (topics !== undefined) post.topics = normalizeTopics(topics);
    if (collab !== undefined && post.type === 'collab') post.collab = shapeCollabInput(collab);
    post.editedAt = new Date();
    await post.save();

    res.json({ post: shapePost(post.toObject(), 0) });
  } catch (err) { next(err); }
});

// ── DELETE /api/posts/:id ────────────────────────────────────────────────────
// Soft delete (status: removed) — keeps comment threads/links intact.
router.delete('/:id', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || post.status === 'removed') return res.status(404).json({ error: 'Post not found' });
    const isOwner = post.authorId === req.user.id;
    const isAdmin = req.user.role === 'superadmin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
    post.status = 'removed';
    await post.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/posts/:id/vote ─────────────────────────────────────────────────
router.post('/:id/vote', voteLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const value = Number(req.body?.value);
    const result = await applyVote({ userId: req.user.id, targetType: 'post', targetId: req.params.id, value });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── POST /api/posts/:id/interest ─────────────────────────────────────────────
// "I'm interested" on a collab post: one click finds-or-creates the DM with the
// poster and drops an intro message in it ("Hi, I'm interested in this
// project…") — no comment needed. The unique Interest record makes it
// idempotent: a second click just returns the existing conversation, it never
// re-sends the intro. Same block rules as starting a conversation manually.
router.post('/:id/interest', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, status: 'active' }).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.type !== 'collab') return res.status(400).json({ error: 'Only collab posts accept interest' });
    if (post.authorId === req.user.id) return res.status(400).json({ error: 'This is your own post' });
    if (post.collab?.status === 'closed') return res.status(400).json({ error: 'This role has been filled' });

    const author = await User.findOne({ id: post.authorId }).lean();
    if (!author) return res.status(404).json({ error: 'User not found' });
    if ((author.blocked || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'This user is not accepting messages' });
    }
    if ((req.user.blocked || []).includes(author.id)) {
      return res.status(403).json({ error: 'You have blocked this user. Unblock them to express interest.' });
    }

    // Find-or-create the DM thread (same atomic upsert as POST /conversations).
    const pairKey = Conversation.pairKeyFor(req.user.id, author.id);
    const now = new Date();
    const convo = await Conversation.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: {
          pairKey,
          participantIds: [req.user.id, author.id].sort(),
          participants: [
            { userId: req.user.id, name: req.user.name, username: req.user.username || '', avatarUrl: req.user.avatarUrl || '', lastReadAt: null },
            { userId: author.id, name: author.name, username: author.username || '', avatarUrl: author.avatarUrl || '', lastReadAt: null },
          ],
          originPostId: post._id,
          // "I'm interested" is a collab request: it lands in the poster's
          // Collab Requests tab, pending until they accept (or reply). The
          // auto-intro below is the requester's one allowed message.
          kind: 'collab',
          status: 'pending',
          requesterId: req.user.id,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Claim the interest FIRST — the unique {userId,postId} index is the atomic
    // dedupe, so two concurrent clicks can't both send an intro. Duplicate key =
    // already expressed → hand back the conversation without re-sending.
    try {
      await Interest.create({ userId: req.user.id, postId: post._id });
    } catch (err) {
      if (err?.code === 11000) return res.json({ ok: true, already: true, conversationId: String(convo._id) });
      throw err;
    }

    // Respect the same one-message gate as manual collab requests: the auto-intro
    // is the requester's ONE allowed message while the thread is pending. If they
    // already sent a message in this thread (e.g. via the Message button first),
    // don't slip a second one in behind the gate — just record the interest.
    const alreadyMessaged = await Message.exists({ conversationId: convo._id, senderId: req.user.id });
    if (alreadyMessaged) {
      return res.status(201).json({ ok: true, already: false, messaged: false, conversationId: String(convo._id) });
    }

    const body = `👋 Hi! I'm interested in this project: "${post.title}". I saw your collab post and would love to work together.`;
    const message = await Message.create({
      conversationId: convo._id,
      senderId: req.user.id,
      body,
      readBy: [req.user.id],
    });
    convo.lastMessage = { text: body.slice(0, 140), senderId: req.user.id, createdAt: message.createdAt };
    convo.updatedAt = message.createdAt;
    await convo.save();

    // Notify the poster that a collab request came in (awaited — serverless can
    // freeze right after the response, dropping a fire-and-forget insert).
    await notify({
      userId: author.id,
      type: 'collab_request',
      actor: req.user,
      postId: post._id,
      conversationId: convo._id,
      snippet: post.title,
    });

    res.status(201).json({ ok: true, already: false, messaged: true, conversationId: String(convo._id) });
  } catch (err) { next(err); }
});

// ── POST /api/posts/:id/save — toggle bookmark ───────────────────────────────
router.post('/:id/save', writeLimiter, objectIdParams('id'), requireAuth, async (req, res, next) => {
  try {
    const removed = await SavedPost.findOneAndDelete({ userId: req.user.id, postId: req.params.id });
    if (removed) return res.json({ saved: false });
    const post = await Post.findOne({ _id: req.params.id, status: 'active' }).select('_id');
    if (!post) return res.status(404).json({ error: 'Post not found' });
    try {
      await SavedPost.create({ userId: req.user.id, postId: req.params.id });
    } catch (err) {
      if (err?.code !== 11000) throw err; // duplicate = concurrent save; already saved
    }
    res.json({ saved: true });
  } catch (err) { next(err); }
});

// ── shaping helpers ──────────────────────────────────────────────────────────
function shapePost(p, myVote, mySaved = false, myInterested = false) {
  return {
    id: String(p._id),
    type: p.type,
    title: p.title,
    body: p.body,
    media: p.media || [],
    topics: p.topics || [],
    collab: p.collab || null,
    author: { id: p.authorId, name: p.authorName, username: p.authorUsername, avatarUrl: p.authorAvatarUrl },
    score: p.score || 0,
    commentCount: p.commentCount || 0,
    myVote: myVote || 0,
    mySaved: !!mySaved,
    myInterested: !!myInterested,
    pinned: !!p.pinned,
    createdAt: p.createdAt,
    editedAt: p.editedAt || null,
  };
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return [...new Set(topics.map(normalizeTopic).filter(Boolean))].slice(0, 5);
}

function sanitizeMedia(media) {
  if (!Array.isArray(media)) return [];
  return media.slice(0, 6).map((m) => ({
    url: sanitizeText(m.url, 1000),
    type: ['image', 'file', 'link'].includes(m.type) ? m.type : 'image',
    name: sanitizeText(m.name, 150), // original filename, used for 'file' (PDFs)
    width: Number(m.width) || undefined,
    height: Number(m.height) || undefined,
    // http(s) only — blocks javascript:/data: URLs from ever being stored, so no
    // future render surface can be handed an executable URL.
  })).filter((m) => m.url && /^https?:\/\//i.test(m.url));
}

function shapeCollabInput(c = {}) {
  return {
    role: sanitizeText(c.role, 120),
    intent: c.intent === 'offering' ? 'offering' : 'looking_for',
    skills: Array.isArray(c.skills) ? c.skills.map((s) => sanitizeText(s, 40)).filter(Boolean).slice(0, 12) : [],
    commitment: ['full_time', 'part_time', 'one_off', 'flexible'].includes(c.commitment) ? c.commitment : '',
    remote: c.remote !== false,
    location: sanitizeText(c.location, 120),
    compType: ['paid', 'equity', 'unpaid', 'negotiable'].includes(c.compType) ? c.compType : '',
    compAmount: sanitizeText(c.compAmount, 60),
    status: c.status === 'closed' ? 'closed' : 'open',
  };
}

module.exports = { router, shapePost };
