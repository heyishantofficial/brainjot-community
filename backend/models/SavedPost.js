const mongoose = require('mongoose');

// Bookmarks. Unique {userId, postId} makes the save toggle idempotent.
const savedPostSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  postId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

savedPostSchema.index({ userId: 1, postId: 1 }, { unique: true });
savedPostSchema.index({ userId: 1, _id: -1 });

module.exports = mongoose.model('SavedPost', savedPostSchema);
