const Notification = require('../models/Notification');
const User = require('../models/User');
const { pushPayloadFor, sendPushToUser } = require('./push');
const logger = require('../utils/logger');

// Notification creation. Never notifies yourself, never throws into the request
// path (a failed notification must not fail the comment/message). Callers should
// `await` it — on serverless the process can freeze right after the response, so
// a truly fire-and-forget insert may never run.
async function notify({ userId, type, actor, postId, commentId, conversationId, snippet }) {
  if (!userId || !actor || userId === actor.id) return;
  try {
    const doc = {
      userId,
      type,
      actor: { id: actor.id, name: actor.name, username: actor.username || '', avatarUrl: actor.avatarUrl || '' },
      postId: postId || null,
      commentId: commentId || null,
      conversationId: conversationId || null,
      snippet: (snippet || '').slice(0, 120),
    };
    await Notification.create(doc);
    // Web push to closed tabs — same awaited-not-forgotten rule as the insert.
    await sendPushToUser(userId, pushPayloadFor(doc));
  } catch (err) {
    logger.warn({ err }, '[notify] failed (non-fatal)');
  }
}

// Extract up to 5 unique @username mentions from plain text and resolve them to
// users. Case-insensitive; usernames are stored lowercase.
async function resolveMentions(plainText) {
  const matches = [...String(plainText || '').matchAll(/@([a-z0-9_.-]{2,30})/gi)]
    .map((m) => m[1].toLowerCase());
  const unique = [...new Set(matches)].slice(0, 5);
  if (!unique.length) return [];
  return User.find({ username: { $in: unique } }).select('id username -_id').lean();
}

module.exports = { notify, resolveMentions };
