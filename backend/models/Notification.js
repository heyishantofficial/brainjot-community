const mongoose = require('mongoose');

// In-app notifications (community-only — deliberately no emails, and kept
// separate from the main app's notifications; the main app only ever shows a
// COUNT on its Community button).
const notificationSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // recipient (main-app user id)
  // collab_request  → someone sent you a collab request (from a collab post)
  // collab_accepted → the person you pitched accepted your collab request
  type: { type: String, enum: ['comment', 'reply', 'mention', 'collab_request', 'collab_accepted'], required: true },
  actor: {
    id: String,
    name: String,
    username: String,
    avatarUrl: String,
  },
  postId: { type: mongoose.Schema.Types.ObjectId, default: null },
  commentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  conversationId: { type: mongoose.Schema.Types.ObjectId, default: null }, // collab_* deep-link target
  snippet: { type: String, default: '' }, // first ~120 chars of the comment
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

notificationSchema.index({ userId: 1, _id: -1 });
notificationSchema.index({ userId: 1, read: 1 });
// Auto-expire after 90 days — old notifications are noise, not records.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('Notification', notificationSchema);
