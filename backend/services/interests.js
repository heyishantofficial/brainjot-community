const Interest = require('../models/Interest');

// Bulk-fetch which of these posts the viewer has expressed interest in — one
// indexed query per feed page, mirroring savesForTargets. Set of postId strings.
async function interestsForTargets(userId, ids) {
  if (!userId || !ids.length) return new Set();
  const rows = await Interest.find({ userId, postId: { $in: ids } }).select('postId -_id').lean();
  return new Set(rows.map((r) => String(r.postId)));
}

module.exports = { interestsForTargets };
