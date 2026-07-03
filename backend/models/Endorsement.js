const mongoose = require('mongoose');

// "Worked together" endorsements. Deliberately mindful: one endorsement per
// pair (unique index), and the route only allows endorsing someone you have a
// DM conversation with — a proxy for "actually interacted", so profiles can't
// be inflated by strangers.
const endorsementSchema = new mongoose.Schema({
  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },
  from: {
    name: String,
    username: String,
    avatarUrl: String,
  },
  skill: { type: String, default: '', maxlength: 40 },  // e.g. "React", "Design"
  text: { type: String, default: '', maxlength: 140 },  // short blurb
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

endorsementSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });
endorsementSchema.index({ toUserId: 1, _id: -1 });

module.exports = mongoose.model('Endorsement', endorsementSchema);
