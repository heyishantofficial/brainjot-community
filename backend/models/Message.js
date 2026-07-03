const mongoose = require('mongoose');

// Individual DM. Separate collection, cursor-paginated by _id within a
// conversation — so a thread can hold millions of messages and still load the
// latest page in constant time.
const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: String, required: true },
  body: { type: String, default: '', maxlength: 4000 },
  attachments: {
    type: [{ url: String, type: String, name: String, _id: false }],
    default: [],
  },
  // Recipients who have read this message (for read receipts / unread counts).
  readBy: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

// Load the latest page of a conversation: newest first, cursor on _id.
messageSchema.index({ conversationId: 1, _id: -1 });

module.exports = mongoose.model('Message', messageSchema);
