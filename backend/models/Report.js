const mongoose = require('mongoose');

// User reports for moderation. Public UGC needs this from day one. A unique index
// on {reporterId, targetType, targetId} stops one user spamming reports on the
// same item; the moderation queue sorts by status + recency.
const reportSchema = new mongoose.Schema({
  reporterId: { type: String, required: true },
  targetType: { type: String, enum: ['post', 'comment', 'user', 'message'], required: true },
  targetId: { type: String, required: true },
  reason: { type: String, enum: ['spam', 'harassment', 'nsfw', 'scam', 'other'], default: 'other' },
  detail: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['open', 'reviewed', 'actioned', 'dismissed'], default: 'open', index: true },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
