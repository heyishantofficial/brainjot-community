const mongoose = require('mongoose');

// Denormalized author snapshot stored on every post/comment. Rendering a feed of
// 20 posts must NOT trigger 20 user lookups — we snapshot the author's display
// fields at write time. A nightly/edit job can refresh stale snapshots; for a
// feed, a slightly stale avatar is fine and the latency win is enormous.
const authorSnapshot = {
  authorId: { type: String, required: true, index: true }, // == User.id
  authorName: { type: String, default: '' },
  authorUsername: { type: String, default: '' },
  authorAvatarUrl: { type: String, default: '' },
};

const mediaSchema = new mongoose.Schema({
  url: String,
  type: { type: String, enum: ['image', 'file', 'link'], default: 'image' },
  name: { type: String, default: '' }, // original filename, shown for 'file' (e.g. PDFs)
  width: Number,
  height: Number,
}, { _id: false });

// Structured collab fields — only populated when type === 'collab'. A collab post
// IS a post (it appears in the feed), so we keep it as fields here rather than a
// separate collection. Comments/votes are still referenced, never embedded, so
// there's no unbounded-array problem.
const collabSchema = new mongoose.Schema({
  role: { type: String, default: '' },            // e.g. "Frontend Developer", "Co-founder"
  intent: { type: String, enum: ['looking_for', 'offering'], default: 'looking_for' },
  skills: { type: [String], default: [] },
  commitment: { type: String, enum: ['full_time', 'part_time', 'one_off', 'flexible', ''], default: '' },
  remote: { type: Boolean, default: true },
  location: { type: String, default: '' },
  compType: { type: String, enum: ['paid', 'equity', 'unpaid', 'negotiable', ''], default: '' },
  compAmount: { type: String, default: '' },        // free-text e.g. "$2k/mo", "5%"
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
}, { _id: false });

const postSchema = new mongoose.Schema({
  ...authorSnapshot,

  type: { type: String, enum: ['discussion', 'showcase', 'question', 'collab'], default: 'discussion', index: true },
  title: { type: String, required: true, maxlength: 300 },
  body: { type: String, default: '' },              // sanitized HTML
  media: { type: [mediaSchema], default: [] },
  topics: { type: [String], default: [], index: true }, // tags, curated list + freeform

  collab: { type: collabSchema, default: undefined },

  // ── Denormalized counters (source of truth = Vote/Comment collections) ──
  // These are updated atomically with $inc when a vote/comment happens, so reads
  // never COUNT(). hotScore is recomputed on each vote and is the feed's sort key.
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  score: { type: Number, default: 0 },              // upvotes - downvotes
  commentCount: { type: Number, default: 0 },
  hotScore: { type: Number, default: 0 },

  status: { type: String, enum: ['active', 'removed'], default: 'active', index: true },
  pinned: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
  editedAt: { type: Date, default: null },
}, { minimize: false });

// ── Indexes that make the feed O(index walk) instead of O(collection scan) ──
// Hot feed: sort by hotScore then _id (tie-breaker + stable cursor).
postSchema.index({ status: 1, hotScore: -1, _id: -1 });
// New feed: _id descending is already creation order (ObjectId encodes time).
postSchema.index({ status: 1, _id: -1 });
// Topic feed.
postSchema.index({ topics: 1, hotScore: -1, _id: -1 });
// A user's profile posts.
postSchema.index({ authorId: 1, _id: -1 });
// Collab board: open collab posts, newest first.
postSchema.index({ type: 1, 'collab.status': 1, _id: -1 });
// Search: title matters most, then topics, then collab role/skills.
postSchema.index(
  { title: 'text', topics: 'text', 'collab.role': 'text', 'collab.skills': 'text' },
  { weights: { title: 10, topics: 5, 'collab.role': 4, 'collab.skills': 3 }, name: 'post_text_search' },
);

module.exports = mongoose.model('Post', postSchema);
