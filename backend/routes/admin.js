const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Message = require('../models/Message');
const Report = require('../models/Report');
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireAdmin, requireAdminUnlock, adminUnlocked } = require('../middleware/auth');
const { readLimiter, writeLimiter, makeLimiter } = require('../middleware/rateLimit');
const { recomputePostHotScore } = require('../services/ranking');

const router = express.Router();

// Every route in this file is superadmin-only. The nav link in the frontend is
// cosmetic — THIS is the actual gate.
router.use(requireAuth, requireAdmin);

// ── Sudo unlock ──────────────────────────────────────────────────────────────
// The dashboard needs a second password (ADMIN_DASH_PASSWORD) on top of the
// superadmin session, so a stolen brainjot login alone can't reach it. Only
// /unlock, /unlock-status and /reports/count (the nav badge) work while locked.

// Hash both sides so timingSafeEqual gets equal-length buffers.
function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(process.env.ADMIN_DASH_PASSWORD)).digest();
  return crypto.timingSafeEqual(a, b);
}

// A password oracle gets a much tighter budget than normal writes.
const unlockLimiter = makeLimiter({ name: 'adminunlock', windowMs: 15 * 60 * 1000, max: 10 });

router.get('/unlock-status', readLimiter, (req, res) => {
  res.json({ configured: !!process.env.ADMIN_DASH_PASSWORD, unlocked: adminUnlocked(req) });
});

router.post('/unlock', unlockLimiter, async (req, res, next) => {
  try {
    if (!process.env.ADMIN_DASH_PASSWORD) {
      return res.status(503).json({ error: 'Admin password not configured on the server', code: 'ADMIN_PASSWORD_UNSET' });
    }
    const ok = passwordMatches(req.body?.password);
    // Both outcomes land in the audit trail — a run of failures IS the signal
    // that someone is sitting on a hijacked superadmin session.
    await AuditLog.create({
      actorId: req.user.id,
      actorName: req.user.name,
      action: ok ? 'admin_unlock' : 'admin_unlock_failed',
      targetType: 'user',
      targetId: req.user.id,
    });
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    req.session.adminUnlockedAt = Date.now();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/count — powers the shield badge in the navbar ─────
// Deliberately above the unlock gate: the badge polls this every 30s and a bare
// count leaks nothing worth a password prompt.
router.get('/reports/count', readLimiter, async (_req, res, next) => {
  try {
    res.json({ open: await Report.countDocuments({ status: 'open' }) });
  } catch (err) { next(err); }
});

// Everything below requires the sudo unlock.
router.use(requireAdminUnlock);

const DAY = 24 * 60 * 60 * 1000;

// Admin-facing user shape: unlike publicUser this includes email + moderation
// fields, so it must never leak outside /api/admin.
function adminUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: u.role || 'user',
    karma: u.karma || 0,
    postCount: u.postCount || 0,
    banned: !!u.banned,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
  };
}

// Sanitized HTML → plain-text snippet for queue/list rows.
function snippet(html, len = 240) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, len);
}

// Daily counts for the last `days` UTC days, zero-filled so the chart never has
// holes. One aggregation per collection — no per-day queries.
async function dailySeries(Model, since, days, extraMatch = {}) {
  const rows = await Model.aggregate([
    { $match: { createdAt: { $gte: since }, ...extraMatch } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
  ]);
  const byDay = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10);
    return { day, n: byDay[day] || 0 };
  });
}

// ── GET /api/admin/stats — the Overview page in one round trip ───────────────
router.get('/stats', readLimiter, async (req, res, next) => {
  try {
    const now = Date.now();
    const h24 = new Date(now - DAY);
    const h48 = new Date(now - 2 * DAY);
    const d7 = new Date(now - 7 * DAY);
    const todayUTC = new Date(); todayUTC.setUTCHours(0, 0, 0, 0);
    const seriesStart = new Date(todayUTC.getTime() - 13 * DAY);

    const [
      totalUsers, bannedUsers, dau, wau,
      signups24h, signupsPrev,
      totalPosts, posts24h, postsPrev,
      totalComments, comments24h, commentsPrev,
      openReports,
      signupSeries, postSeries, commentSeries,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ banned: true }),
      User.countDocuments({ lastSeenAt: { $gte: h24 } }),
      User.countDocuments({ lastSeenAt: { $gte: d7 } }),
      User.countDocuments({ createdAt: { $gte: h24 } }),
      User.countDocuments({ createdAt: { $gte: h48, $lt: h24 } }),
      Post.countDocuments({ status: 'active' }),
      Post.countDocuments({ createdAt: { $gte: h24 } }),
      Post.countDocuments({ createdAt: { $gte: h48, $lt: h24 } }),
      Comment.countDocuments({ status: 'active' }),
      Comment.countDocuments({ createdAt: { $gte: h24 } }),
      Comment.countDocuments({ createdAt: { $gte: h48, $lt: h24 } }),
      Report.countDocuments({ status: 'open' }),
      dailySeries(User, seriesStart, 14),
      dailySeries(Post, seriesStart, 14),
      dailySeries(Comment, seriesStart, 14),
    ]);

    res.json({
      users: { total: totalUsers, banned: bannedUsers, dau, wau, last24h: signups24h, prev24h: signupsPrev },
      posts: { total: totalPosts, last24h: posts24h, prev24h: postsPrev },
      comments: { total: totalComments, last24h: comments24h, prev24h: commentsPrev },
      reports: { open: openReports },
      series: { signups: signupSeries, posts: postSeries, comments: commentSeries },
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports — moderation queue with hydrated targets ──────────
// The base /api/reports queue returns bare ids; a moderator can't judge content
// they can't see. This variant batch-loads every referenced post/comment/user/
// message (grouped per type — never one query per report).
router.get('/reports', readLimiter, async (req, res, next) => {
  try {
    const status = ['open', 'reviewed', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const reports = await Report.find({ status }).sort({ createdAt: -1 }).limit(100).lean();

    const idsOf = (type) => [...new Set(reports.filter((r) => r.targetType === type).map((r) => r.targetId))];
    const objectIds = (list) => list.filter((id) => mongoose.isValidObjectId(id));

    const [posts, comments, messages] = await Promise.all([
      Post.find({ _id: { $in: objectIds(idsOf('post')) } })
        .select('title body status authorId authorName authorUsername score commentCount reportCount createdAt').lean(),
      Comment.find({ _id: { $in: objectIds(idsOf('comment')) } })
        .select('body status authorId authorName authorUsername postId createdAt').lean(),
      Message.find({ _id: { $in: objectIds(idsOf('message')) } })
        .select('body senderId createdAt').lean(),
    ]);

    // One user batch covers reporters + reported users + message senders.
    const userIds = new Set([
      ...reports.map((r) => r.reporterId),
      ...idsOf('user'),
      ...messages.map((m) => m.senderId),
    ]);
    const users = await User.find({ id: { $in: [...userIds] } })
      .select('id name username avatarUrl banned karma').lean();
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));

    const postById = Object.fromEntries(posts.map((p) => [String(p._id), p]));
    const commentById = Object.fromEntries(comments.map((c) => [String(c._id), c]));
    const messageById = Object.fromEntries(messages.map((m) => [String(m._id), m]));

    const items = reports.map((r) => {
      let target = null;
      if (r.targetType === 'post') {
        const p = postById[r.targetId];
        if (p) {
          target = {
            title: p.title, snippet: snippet(p.body), status: p.status,
            authorId: p.authorId, authorName: p.authorName, authorUsername: p.authorUsername,
            score: p.score, commentCount: p.commentCount, reportCount: p.reportCount, createdAt: p.createdAt,
          };
        }
      } else if (r.targetType === 'comment') {
        const c = commentById[r.targetId];
        if (c) {
          target = {
            snippet: snippet(c.body), status: c.status, postId: String(c.postId),
            authorId: c.authorId, authorName: c.authorName, authorUsername: c.authorUsername, createdAt: c.createdAt,
          };
        }
      } else if (r.targetType === 'user') {
        const u = userById[r.targetId];
        if (u) target = { authorId: u.id, authorName: u.name, authorUsername: u.username, banned: u.banned, karma: u.karma };
      } else if (r.targetType === 'message') {
        const m = messageById[r.targetId];
        if (m) {
          const sender = userById[m.senderId];
          target = { snippet: snippet(m.body), authorId: m.senderId, authorName: sender?.name || '', authorUsername: sender?.username || '', createdAt: m.createdAt };
        }
      }
      const reporter = userById[r.reporterId];
      return {
        id: String(r._id),
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        detail: r.detail,
        status: r.status,
        createdAt: r.createdAt,
        reporter: reporter ? { id: reporter.id, name: reporter.name, username: reporter.username } : null,
        target, // null → content already hard-deleted; the queue row says so
      };
    });

    res.json({ items });
  } catch (err) { next(err); }
});

// ── GET /api/admin/users — searchable user directory ─────────────────────────
router.get('/users', readLimiter, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const filter = String(req.query.filter || 'all');
    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const limit = 30;

    const match = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [{ name: rx }, { username: rx }, { email: rx }];
    }
    if (filter === 'banned') match.banned = true;
    if (filter === 'admins') match.role = 'superadmin';

    const [items, total] = await Promise.all([
      User.find(match).sort({ createdAt: -1 }).skip(page * limit).limit(limit).lean(),
      User.countDocuments(match),
    ]);
    res.json({ items: items.map(adminUser), total, page, pageSize: limit });
  } catch (err) { next(err); }
});

// ── GET /api/admin/users/:id — the full dossier for the detail panel ─────────
router.get('/users/:id', readLimiter, async (req, res, next) => {
  try {
    const user = await User.findOne({ id: req.params.id }).lean();
    if (!user) return res.status(404).json({ error: 'Not found' });

    const [postsTotal, postsRemoved, commentsTotal, commentsRemoved,
      reportsAgainst, reportsFiled, contentReports, recentPosts, recentComments, audit] = await Promise.all([
      Post.countDocuments({ authorId: user.id }),
      Post.countDocuments({ authorId: user.id, status: 'removed' }),
      Comment.countDocuments({ authorId: user.id }),
      Comment.countDocuments({ authorId: user.id, status: 'removed' }),
      Report.countDocuments({ targetType: 'user', targetId: user.id }),
      Report.countDocuments({ reporterId: user.id }),
      // Reports pointing at this user's posts, via the denormalized counter.
      Post.aggregate([
        { $match: { authorId: user.id } },
        { $group: { _id: null, n: { $sum: '$reportCount' } } },
      ]).then((r) => r[0]?.n || 0),
      Post.find({ authorId: user.id }).sort({ _id: -1 }).limit(5)
        .select('title status score commentCount reportCount createdAt').lean(),
      Comment.find({ authorId: user.id }).sort({ _id: -1 }).limit(5)
        .select('body status postId createdAt').lean(),
      AuditLog.find({ targetType: 'user', targetId: user.id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    res.json({
      user: adminUser(user),
      counts: {
        posts: postsTotal, postsRemoved,
        comments: commentsTotal, commentsRemoved,
        reportsAgainst, reportsFiled, contentReports,
      },
      recentPosts: recentPosts.map((p) => ({ id: String(p._id), title: p.title, status: p.status, score: p.score, commentCount: p.commentCount, reportCount: p.reportCount, createdAt: p.createdAt })),
      recentComments: recentComments.map((c) => ({ id: String(c._id), snippet: snippet(c.body, 140), status: c.status, postId: String(c.postId), createdAt: c.createdAt })),
      audit: audit.map((a) => ({ action: a.action, actorName: a.actorName, meta: a.meta, createdAt: a.createdAt })),
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/users/:id — ban / unban, optionally purge content ───────
// Banning takes effect on the target's NEXT request: requireAuth rejects banned
// users, so their live session dies without us touching the session store.
router.patch('/users/:id', writeLimiter, async (req, res, next) => {
  try {
    const { banned, purgeContent } = req.body || {};
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(400).json({ error: 'Superadmins cannot be moderated from the dashboard' });

    const audit = [];

    if (typeof banned === 'boolean' && banned !== user.banned) {
      user.banned = banned;
      await user.save();
      audit.push({ action: banned ? 'ban_user' : 'unban_user', targetType: 'user', targetId: user.id });
    }

    const purged = { posts: 0, comments: 0 };
    if (purgeContent === true) {
      // Posts: soft-remove (status filter hides them everywhere; undo-able by DB).
      const postIds = (await Post.find({ authorId: user.id, status: 'active' }).select('_id').lean()).map((p) => p._id);
      if (postIds.length) {
        await Post.updateMany({ _id: { $in: postIds } }, { $set: { status: 'removed' } });
        purged.posts = postIds.length;
      }

      // Comments live on OTHER people's posts — removing them must also fix
      // those posts' commentCount and hot score, or the feed ranks on ghosts.
      const comments = await Comment.find({ authorId: user.id, status: 'active' }).select('_id postId').lean();
      if (comments.length) {
        await Comment.updateMany({ _id: { $in: comments.map((c) => c._id) } }, { $set: { status: 'removed', body: '' } });
        purged.comments = comments.length;
        const perPost = new Map();
        for (const c of comments) {
          const key = String(c.postId);
          perPost.set(key, (perPost.get(key) || 0) + 1);
        }
        await Post.bulkWrite([...perPost].map(([postId, n]) => ({
          updateOne: { filter: { _id: postId }, update: { $inc: { commentCount: -n } } },
        })));
        for (const postId of perPost.keys()) await recomputePostHotScore(postId);
      }

      // The purge resolves every open report that pointed at this content.
      await Report.updateMany(
        {
          status: 'open',
          $or: [
            { targetType: 'post', targetId: { $in: postIds.map(String) } },
            { targetType: 'comment', targetId: { $in: comments.map((c) => String(c._id)) } },
            { targetType: 'user', targetId: user.id },
          ],
        },
        { $set: { status: 'actioned' } },
      );

      audit.push({ action: 'purge_content', targetType: 'user', targetId: user.id, meta: purged });
    }

    if (audit.length) {
      await AuditLog.insertMany(audit.map((a) => ({ ...a, actorId: req.user.id, actorName: req.user.name })));
    }

    res.json({ user: adminUser(user), purged });
  } catch (err) { next(err); }
});

module.exports = { router };
