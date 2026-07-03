const express = require('express');
const Report = require('../models/Report');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimit');
const { sanitizeText } = require('../utils/sanitize');
const { objectIdParams } = require('../middleware/objectId');

const router = express.Router();

// ── POST /api/reports ────────────────────────────────────────────────────────
// Any logged-in user can report content. The unique {reporter,target} index
// quietly dedupes repeat reports (upsert → no error spam).
router.post('/', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    const { targetType, targetId, reason, detail } = req.body || {};
    if (!['post', 'comment', 'user', 'message'].includes(targetType) || !targetId) {
      return res.status(400).json({ error: 'Invalid report target' });
    }
    await Report.findOneAndUpdate(
      { reporterId: req.user.id, targetType, targetId: String(targetId) },
      {
        $setOnInsert: {
          reporterId: req.user.id,
          targetType,
          targetId: String(targetId),
          reason: ['spam', 'harassment', 'nsfw', 'scam', 'other'].includes(reason) ? reason : 'other',
          detail: sanitizeText(detail, 500),
          status: 'open',
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/reports (admin) — the moderation queue ──────────────────────────
router.get('/', readLimiter, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const status = ['open', 'reviewed', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const reports = await Report.find({ status }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ items: reports });
  } catch (err) { next(err); }
});

// ── PATCH /api/reports/:id (admin) — resolve + optionally remove content ──────
router.patch('/:id', writeLimiter, objectIdParams('id'), requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { status, removeContent } = req.body || {};
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    if (['reviewed', 'actioned', 'dismissed'].includes(status)) report.status = status;
    await report.save();

    if (removeContent) {
      if (report.targetType === 'post') await Post.updateOne({ _id: report.targetId }, { $set: { status: 'removed' } });
      if (report.targetType === 'comment') await Comment.updateOne({ _id: report.targetId }, { $set: { status: 'removed', body: '' } });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router };
