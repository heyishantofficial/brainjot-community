const SavedPost = require('../models/SavedPost');

// Bulk-fetch which of these posts the viewer has saved — one indexed query per
// feed page, mirroring votesForTargets. Returns a Set of postId strings.
async function savesForTargets(userId, ids) {
  if (!userId || !ids.length) return new Set();
  const rows = await SavedPost.find({ userId, postId: { $in: ids } }).select('postId -_id').lean();
  return new Set(rows.map((r) => String(r.postId)));
}

module.exports = { savesForTargets };
