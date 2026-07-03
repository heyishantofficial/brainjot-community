const mongoose = require('mongoose');

// Comments are their OWN collection — never an embedded array on the post. A
// viral post with 10k comments would otherwise be one 16MB-capped document that's
// rewritten on every reply and impossible to paginate. As separate documents we
// can cursor-paginate them and rank them independently.
//
// Threading uses a parent pointer plus a materialized `path` (array of ancestor
// ids). The path lets us load an entire subtree with one indexed range query and
// sort a flat result into a tree on the client, without recursive lookups.
const commentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  path: { type: [mongoose.Schema.Types.ObjectId], default: [] }, // root → ... → parent
  depth: { type: Number, default: 0 },

  authorId: { type: String, required: true, index: true },
  authorName: { type: String, default: '' },
  authorUsername: { type: String, default: '' },
  authorAvatarUrl: { type: String, default: '' },

  body: { type: String, default: '' }, // sanitized HTML

  // Denormalized vote counters (source of truth = Vote collection).
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 }, // Wilson lower bound for "Top" sort
  replyCount: { type: Number, default: 0 },

  status: { type: String, enum: ['active', 'removed'], default: 'active' },

  createdAt: { type: Date, default: Date.now },
  editedAt: { type: Date, default: null },
}, { minimize: false });

// Load a post's comments newest/oldest first with a cursor.
commentSchema.index({ postId: 1, _id: 1 });
// Load a subtree (all descendants of a comment) in one range query.
commentSchema.index({ postId: 1, path: 1 });
// "Top" comment sort.
commentSchema.index({ postId: 1, confidence: -1 });

module.exports = mongoose.model('Comment', commentSchema);
