const Vote = require('../models/Vote');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const { hotScore, confidence } = require('../utils/score');

const MODELS = { post: Post, comment: Comment };

// Apply a vote to a post or comment. Handles the three cases — new vote, toggle
// off (same direction again), and switch direction — and keeps the target's
// denormalized counters in sync via atomic $inc. Counter math is done with $inc
// (atomic per field) and the unique {userId,target} index guarantees one vote per
// user, so we never need a read-modify-write transaction that would race at load.
//
// Returns { score, value } where value is the user's resulting vote (0 = none).
async function applyVote({ userId, targetType, targetId, value }) {
  const Model = MODELS[targetType];
  if (!Model) throw Object.assign(new Error('bad target'), { status: 400 });
  if (value !== 1 && value !== -1) throw Object.assign(new Error('bad value'), { status: 400 });

  const target = await Model.findById(targetId).select('authorId upvotes downvotes createdAt status');
  if (!target || target.status === 'removed') {
    throw Object.assign(new Error('not found'), { status: 404 });
  }

  const prev = await Vote.findOne({ userId, targetType, targetId });

  let upDelta = 0;
  let downDelta = 0;
  let resultValue = value;

  if (!prev) {
    try {
      await Vote.create({ userId, targetType, targetId, value });
    } catch (err) {
      // E11000 = a concurrent request from the same user already inserted this
      // vote (double-click race). The unique index kept the data correct; treat
      // this request as a no-op instead of surfacing a 500.
      if (err?.code === 11000) {
        const current = await Model.findById(targetId).select('upvotes downvotes').lean();
        return { score: (current?.upvotes || 0) - (current?.downvotes || 0), value };
      }
      throw err;
    }
    if (value === 1) upDelta = 1; else downDelta = 1;
  } else if (prev.value === value) {
    // Same direction again → toggle the vote off.
    await Vote.deleteOne({ _id: prev._id });
    if (value === 1) upDelta = -1; else downDelta = -1;
    resultValue = 0;
  } else {
    // Switch direction.
    prev.value = value;
    await prev.save();
    if (value === 1) { upDelta = 1; downDelta = -1; } else { upDelta = -1; downDelta = 1; }
  }

  // Atomically bump counters, get the new totals back.
  const updated = await Model.findByIdAndUpdate(
    targetId,
    { $inc: { upvotes: upDelta, downvotes: downDelta } },
    { new: true, select: 'upvotes downvotes createdAt' },
  );

  const score = updated.upvotes - updated.downvotes;
  const set = { score };
  if (targetType === 'post') {
    set.hotScore = hotScore(updated.upvotes, updated.downvotes, updated.createdAt);
  } else {
    set.confidence = confidence(updated.upvotes, updated.downvotes);
  }
  await Model.updateOne({ _id: targetId }, { $set: set });

  // Reflect the change in the author's karma (denormalized, $inc — never recounted).
  const karmaDelta = upDelta - downDelta;
  if (karmaDelta !== 0 && target.authorId && target.authorId !== userId) {
    await User.updateOne({ id: target.authorId }, { $inc: { karma: karmaDelta } });
  }

  return { score, value: resultValue };
}

// Bulk-fetch the current user's votes for a set of targets, so a feed render can
// show vote state without N queries. Returns a Map of targetId(string) → value.
async function votesForTargets(userId, targetType, ids) {
  if (!userId || !ids.length) return new Map();
  const votes = await Vote.find({ userId, targetType, targetId: { $in: ids } })
    .select('targetId value -_id').lean();
  return new Map(votes.map((v) => [String(v.targetId), v.value]));
}

module.exports = { applyVote, votesForTargets };
