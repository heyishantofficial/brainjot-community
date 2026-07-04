const mongoose = require('mongoose');

// Mirrored user. The main app is the source of truth for identity; we keep a
// LOCAL copy (upserted on SSO login) so the community has ZERO runtime dependency
// on the main app's database. `id` is the main app's user id — identical on both
// sides, which is what makes the collab→invite loop work (the hirer can invite
// this exact person into a Project/Space on the main app).
// LinkedIn-style entries. start/end are free-text ("2022", "Mar 2023") — real
// date pickers add friction for zero analytical gain; these are display-only.
const experienceSchema = new mongoose.Schema({
  title: { type: String, default: '', maxlength: 80 },
  org: { type: String, default: '', maxlength: 80 },
  start: { type: String, default: '', maxlength: 20 },
  end: { type: String, default: '', maxlength: 20 }, // '' = present
  description: { type: String, default: '', maxlength: 300 },
}, { _id: false });

const educationSchema = new mongoose.Schema({
  school: { type: String, default: '', maxlength: 80 },
  degree: { type: String, default: '', maxlength: 80 },
  start: { type: String, default: '', maxlength: 20 },
  end: { type: String, default: '', maxlength: 20 },
  description: { type: String, default: '', maxlength: 300 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // == main app User.id
  name: { type: String, required: true, trim: true },
  username: { type: String, lowercase: true, trim: true, index: true },
  email: { type: String, lowercase: true, trim: true },
  avatarUrl: { type: String, default: '' },
  role: { type: String, enum: ['user', 'superadmin'], default: 'user' },

  // Community-local profile fields (not present on the main app).
  headline: { type: String, default: '', maxlength: 100 }, // one-liner under the name
  bio: { type: String, default: '', maxlength: 1000 },     // "About" section
  skills: { type: [String], default: [] },
  links: {
    website: { type: String, default: '' },
    github: { type: String, default: '' },
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
  },
  experience: { type: [experienceSchema], default: [] },
  education: { type: [educationSchema], default: [] },
  openTo: { type: [String], default: [] }, // 'collabs' | 'hire'
  followedTopics: { type: [String], default: [] }, // powers the "For you" feed
  blocked: { type: [String], default: [] },        // user ids I've blocked (DM shield)
  mutedKeywords: { type: [String], default: [] },  // feed never shows posts containing these

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
