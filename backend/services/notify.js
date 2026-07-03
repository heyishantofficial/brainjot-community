const Notification = require('../models/Notification');
const User = require('../models/User');
const logger = require('../utils/logger');

// Fire-and-forget notification creation. Never notifies yourself, never throws
// into the request path (a failed notification must not fail the comment).
async function notify({ userId, type, actor, postId, commentId, snippet }) {
  if (!userId || !actor || userId === actor.id) return;
  try {
    await Notification.create({
      userId,
      type,
      actor: { id: actor.id, name: actor.name, username: actor.username || '', avatarUrl: actor.avatarUrl || '' },
      postId: postId || null,
      commentId: commentId || null,
      snippet: (snippet || '').slice(0, 120),
    });
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
