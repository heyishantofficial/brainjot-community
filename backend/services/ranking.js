const Post = require('../models/Post');
const { hotScore } = require('../utils/score');

// Recompute and store a post's hotScore from its current counters. Called after
// any counter changes OUTSIDE the vote path (comments, reports) — the vote path
// (services/voting.js) recomputes inline because it already holds the fresh doc.
//
// Two round-trips ($inc happened just before, then read + $set here) instead of
// a transaction: hotScore is a ranking hint, not money. If two events race, the
// later recompute reads both $incs and lands on the right value anyway.
async function recomputePostHotScore(postId) {
  const post = await Post.findById(postId)
    .select('upvotes downvotes commentCount reportCount createdAt').lean();
  if (!post) return;
  await Post.updateOne({ _id: postId }, { $set: { hotScore: hotScore(post) } });
}

module.exports = { recomputePostHotScore };
