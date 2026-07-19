# brainjot Community

A standalone, Reddit-style community for brainjot — posts, threaded comments,
voting, a collab/hiring board, and direct messaging — at **community.brainjot.space**.

It is **fully isolated** from the main app: its own backend, its own database, its
own deploy. The main app's only involvement is identity (SSO) and a single
"Community" link near the search icon. A traffic spike here can never take the
main app down.

```
brainjot-community/
├── backend/   Node/Express + MongoDB (own DB, own deploy)
└── frontend/  React + Vite SPA (own deploy → community.brainjot.space)
```

**Deployment:** two Dokploy services on the Hostinger VPS (static frontend +
long-running Node backend) + a MongoDB database separate from the main app's.
DMs currently use **polling**; the websocket path is kept as an escape hatch and
is now viable since the backend is a persistent process. Full step-by-step: see
[DEPLOY.md](DEPLOY.md).

## How auth works (SSO, near-zero load on the main app)

1. User opens `community.brainjot.space`. The frontend asks our backend `/auth/me`.
2. If not logged in, the frontend silently calls the **main app's**
   `GET /api/community/sso-token` (with credentials → uses the existing main-app
   login cookie). This is the *only* call ever made to the main app.
3. The main app mints a short-lived JWT (signed with `COMMUNITY_JWT_SECRET`).
4. The frontend posts it to our `/auth/sso-login`; we verify the JWT **locally**
   (no callback to the main app), upsert a mirrored user, and start our own
   session. After this, the main app is never touched again until re-login.

Because the user id is identical on both sides, the collab→invite loop works: in a
DM, "Invite to project" deep-links the hirer into the main app's existing invite
flow for that exact person.

## Local development

**Prereqs:** Node ≥ 18, a local MongoDB (`brew services start mongodb-community`).

```bash
# backend
cd backend
cp .env.example .env          # then fill SESSION_SECRET + COMMUNITY_JWT_SECRET
npm install
npm run dev                   # → http://localhost:4000

# frontend (new terminal)
cd frontend
cp .env.example .env          # VITE_API_URL=http://localhost:4000
npm install
npm run dev                   # → http://localhost:5174
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

`COMMUNITY_JWT_SECRET` **must be identical** in the community backend `.env` and in
the main app's environment.

## Main app changes (already applied)

1. `backend/server.js` — added `community.brainjot.space` (+ localhost:5174) to the
   CORS allowlist.
2. `backend/routes/api.js` — added `GET /api/community/sso-token` (mints the SSO JWT).
   Requires `jsonwebtoken` (installed) and the `COMMUNITY_JWT_SECRET` env var.
3. `frontend/.../DashboardView.jsx` — added the "Community" button next to search
   (links to `VITE_COMMUNITY_URL`, default `https://community.brainjot.space`).

## Production deploy

Full runbook with every env var is in **[DEPLOY.md](DEPLOY.md)**. In short:
two Dokploy services (`community-frontend` → `community.brainjot.space`,
`community-backend` → `api.community.brainjot.space`), a **separate** MongoDB
database, and `COMMUNITY_JWT_SECRET` set to the same value on both this backend
and the main app.

## Scale foundation (why this survives growth)

Built so the expensive-to-reverse decisions are already correct:

- **Reference, never embed.** Comments, votes, and messages are their own
  collections — no unbounded arrays inside a post/conversation document.
- **Cursor pagination everywhere** (`utils/cursor.js`) — feeds seek by indexed
  `_id`/`hotScore` ranges, never `.skip()`, so deep scroll stays O(1).
- **Denormalized counters via `$inc`** — score/commentCount/karma are never
  recounted at read time; the "hot" rank is precomputed and indexed.
- **Idempotent voting** — a unique `{userId,target}` index makes double-votes
  impossible without read-modify-write races.
- **Stateless backend** — sessions and rate-limits use external (Mongo/Redis)
  stores, the Mongo connection is cached and shared, and nothing lives in
  process memory. Set `REDIS_URL` to move sessions/rate-limits to Redis when you
  scale out.
- **Realtime escape hatch** — DMs run on polling today. To go instant, add
  websockets to the backend and swap `Conversation.jsx` + the header badge back
  to sockets; the Redis socket-adapter wiring is already in `config/stores.js`
  + `sockets/`.

### What's deliberately deferred (don't over-build)

Redis (flip on at 2+ instances), CDN for media, Mongo read replicas, a background
job queue, and full-text search are all config/infra additions later — the
stateless design means none require a rewrite.

## Verified

26/26 end-to-end API tests pass against a real MongoDB: SSO login, post create +
HTML sanitization, idempotent voting (upvote → toggle-off → switch), threaded
comments with live counters, DM find-or-create + unread, and reports.
