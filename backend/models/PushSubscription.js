const mongoose = require('mongoose');

// One document per browser push subscription (a user can have several —
// laptop + phone). endpoint is globally unique per the Push API spec, so
// re-subscribing (or another user on the same browser) upserts in place.
const pushSubSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PushSubscription', pushSubSchema);
