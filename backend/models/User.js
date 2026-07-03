const mongoose = require('mongoose');

// Mirrored user. The main app is the source of truth for identity; we keep a
// LOCAL copy (upserted on SSO login) so the community has ZERO runtime dependency
// on the main app's database. `id` is the main app's user id — identical on both
// sides, which is what makes the collab→invite loop work (the hirer can invite
// this exact person into a Project/Space on the main app).
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // == main app User.id
  name: { type: String, required: true, trim: true },
  username: { type: String, lowercase: true, trim: true, index: true },
  email: { type: String, lowercase: true, trim: true },
  avatarUrl: { type: String, default: '' },
  role: { type: String, enum: ['user', 'superadmin'], default: 'user' },

  // Community-local profile fields (not present on the main app).
  bio: { type: String, default: '', maxlength: 280 },
  skills: { type: [String], default: [] },
  followedTopics: { type: [String], default: [] }, // powers the "For you" feed
  blocked: { type: [String], default: [] },        // user ids I've blocked (DM shield)

  // Denormalized reputation — updated via $inc as the user's posts/comments are
  // voted on. Never computed by scanning their content at read time.
  karma: { type: Number, default: 0 },
  postCount: { type: Number, default: 0 },

  // Moderation.
  banned: { type: Boolean, default: false },

  lastSeenAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

module.exports = mongoose.model('User', userSchema);
