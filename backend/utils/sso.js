const jwt = require('jsonwebtoken');

// ── SSO token verification ───────────────────────────────────────────────────
// The main app is the identity provider. On login it mints a short-lived JWT
// signed with COMMUNITY_JWT_SECRET (a secret shared ONLY between the two
// backends). We verify that token LOCALLY here — no network call back to the main
// app per request — then exchange it for a community session. After that, the
// main app is never touched again until the session expires. That's how the
// community carries its own load without ever leaning on the main app.

const ISSUER = 'brainjot-app';
const AUDIENCE = 'brainjot-community';

function verifySsoToken(token) {
  const secret = process.env.COMMUNITY_JWT_SECRET;
  if (!secret) {
    const err = new Error('COMMUNITY_JWT_SECRET not configured');
    err.code = 'NO_SECRET';
    throw err;
  }
  // Throws on expiry/signature/issuer/audience mismatch — caller maps to 401.
  const payload = jwt.verify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    maxAge: '5m', // tokens are single-use-ish; reject anything older than 5 min
  });
  return {
    id: payload.sub,
    name: payload.name || '',
    username: payload.username || '',
    email: payload.email || '',
    avatarUrl: payload.avatarUrl || '',
    role: payload.role || 'user',
  };
}

// Helper documenting exactly what the MAIN APP must sign (mirror of verify).
// Implemented on the main app side; included here as the contract reference.
function signSsoTokenForReference(user, secret) {
  return jwt.sign(
    {
      sub: user.id,
      name: user.name,
      username: user.username || '',
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      role: user.role || 'user',
    },
    secret,
    { issuer: ISSUER, audience: AUDIENCE, expiresIn: '2m' },
  );
}

module.exports = { verifySsoToken, signSsoTokenForReference, ISSUER, AUDIENCE };
