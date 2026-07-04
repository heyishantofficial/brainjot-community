// One-off backfill after the hot-score formula changed (votes-only → weighted
// votes + comments − reports). Re-scores every post so old posts rank on the
// same scale as new ones, and seeds reportCount from the Report collection.
//
// Safe to re-run any time (it's a pure recompute). Run it once after deploying
// the weighted-scoring release:
//
//   MONGODB_URI="mongodb+srv://…" node scripts/recompute-hot-scores.js
//
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Post = require('../models/Post');
const Report = require('../models/Report');
const { hotScore } = require('../utils/score');

async function main() {
  await connectDB();

  // reportCount = distinct non-dismissed reports per post (dismissed ones were
  // false alarms and carry no ranking penalty).
  const counts = await Report.aggregate([
    { $match: { targetType: 'post', status: { $ne: 'dismissed' } } },
    { $group: { _id: '$targetId', n: { $sum: 1 } } },
  ]);
  const reportCountByPost = new Map(counts.map((c) => [String(c._id), c.n]));

  let scanned = 0;
  let updated = 0;
  let ops = [];

  // Streamed cursor + bulkWrite batches: constant memory at any collection size.
  for await (const post of Post.find({})
    .select('upvotes downvotes commentCount reportCount createdAt hotScore').lean().cursor()) {
    scanned += 1;
    const reportCount = reportCountByPost.get(String(post._id)) || 0;
    const next = hotScore({ ...post, reportCount });
    if (next !== post.hotScore || reportCount !== (post.reportCount || 0)) {
      ops.push({
        updateOne: {
          filter: { _id: post._id },
          update: { $set: { hotScore: next, reportCount } },
        },
      });
    }
    if (ops.length >= 500) {
      const res = await Post.bulkWrite(ops, { ordered: false });
      updated += res.modifiedCount;
      ops = [];
    }
  }
  if (ops.length) {
    const res = await Post.bulkWrite(ops, { ordered: false });
    updated += res.modifiedCount;
  }

  console.log(`[recompute-hot-scores] scanned ${scanned} posts, updated ${updated}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[recompute-hot-scores] failed:', err);
  process.exit(1);
});
