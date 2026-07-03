const crypto = require('crypto');

// Short, URL-safe, collision-resistant id. Used for human-facing slugs/tokens.
// Mongo's own ObjectId (_id) is the primary key everywhere — these are extras.
function uid(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { uid };
