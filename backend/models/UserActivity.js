const mongoose = require('mongoose');

// One row per user per active week — the raw material for growth accounting
// (new/retained/resurrected/churned) and cohort retention, which need HISTORY
// that a single lastSeenAt field can never give back. Written by the throttled
// activity touch in server.js and at SSO login; the unique index makes
// repeated upserts free.
const userActivitySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  week: { type: String, required: true },      // Monday of the week, 'YYYY-MM-DD'
  weekStart: { type: Date, required: true },
});

userActivitySchema.index({ userId: 1, week: 1 }, { unique: true });
userActivitySchema.index({ weekStart: 1 });

module.exports = mongoose.model('UserActivity', userActivitySchema);
