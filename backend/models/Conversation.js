const mongoose = require('mongoose');

// A 1:1 DM conversation. Messages live in their OWN collection (see Message.js) —
// never embedded here — so a long-running chat doesn't grow this document without
// bound. This doc holds only participants, a snapshot of the last message (for
// the inbox preview), and per-participant read state (for unread badges).
//
// `pairKey` is the two sorted participant ids joined — a unique index on it makes
// "find or create the conversation between A and B" atomic and idempotent, so two
// people messaging each other simultaneously can't create duplicate threads.
const participantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: String,
  username: String,
  avatarUrl: String,
  lastReadAt: { type: Date, default: null }, // for unread counts
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  pairKey: { type: String, required: true, unique: true },
  participantIds: { type: [String], required: true, index: true },
  participants: { type: [participantSchema], default: [] },

  lastMessage: {
    text: { type: String, default: '' },
    senderId: { type: String, default: '' },
    createdAt: { type: Date, default: null },
  },

  // Optional context: a conversation started from a specific collab post.
  originPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now, index: true }, // inbox sort key
}, { minimize: false });

// Inbox query: conversations I'm in, most recently active first.
conversationSchema.index({ participantIds: 1, updatedAt: -1 });

// Build the canonical pair key for two user ids (order-independent).
conversationSchema.statics.pairKeyFor = function (a, b) {
  return [a, b].sort().join(':');
};

module.exports = mongoose.model('Conversation', conversationSchema);
