const mongoose = require('mongoose');

// "I'm interested" on a collab post. Unique {userId, postId} makes the action
// idempotent — clicking twice (or on two devices) can never send the intro DM
// twice. Kept as its own collection (like SavedPost) so shapePost can bulk-load
// the viewer's interest state in one indexed query per feed page.
const interestSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

interestSchema.index({ userId: 1, postId: 1 }, { unique: true });
interestSchema.index({ postId: 1 }); // "who's interested" per post

module.exports = mongoose.model('Interest', interestSchema);
