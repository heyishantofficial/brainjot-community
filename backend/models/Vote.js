const mongoose = require('mongoose');

// A vote is its own document and the SOURCE OF TRUTH for who voted on what. The
// post/comment only carry denormalized counters (upvotes/downvotes/score) kept in
// sync via atomic $inc. We never recount votes at read time.
//
// The unique compound index {userId, targetType, targetId} enforces idempotency
// at the database level: a user can have at most one vote per target, so a
// double-click or a retry can't double-count, and we never need a read-modify-
// write transaction to dedupe (which would race under load).
const voteSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  targetType: { type: String, enum: ['post', 'comment'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  value: { type: Number, enum: [1, -1], required: true },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

voteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('Vote', voteSchema);
