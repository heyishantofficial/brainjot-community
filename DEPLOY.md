# Deploying brainjot Community

Two Vercel projects (frontend + serverless backend) + a separate MongoDB Atlas
cluster. Mirrors how the main app is deployed. ~20 minutes end to end.

```
community.brainjot.space      → Vercel project: community-frontend (static Vite)
api.community.brainjot.space  → Vercel project: community-backend  (@vercel/node)
                              → MongoDB Atlas: SEPARATE cluster (isolation)
```

The backend lives on `api.community.brainjot.space` (a brainjot.space subdomain),
**not** a `*.vercel.app` URL, so the session cookie stays first-party and Safari/
Brave don't block it.

---

## 1. MongoDB Atlas (separate cluster)

1. Create a **new Atlas project** (not the main app's) → a free **M0** cluster.
2. Database Access → add a user (e.g. `community`) with a strong password.
3. Network Access → allow `0.0.0.0/0` (Vercel egress IPs are dynamic), or use the
   Vercel ↔ Atlas integration.
4. Copy the connection string →
   `mongodb+srv://community:<pw>@<cluster>/brainjot_community?retryWrites=true&w=majority`

> This separate cluster is the isolation guarantee — a community spike can never
> touch the main app's database.

## 2. Backend → Vercel project `community-backend`

- New Project → import the repo → **Root Directory = `brainjot-community/backend`**.
- Framework preset: **Other** (the `vercel.json` handles routing to `server.js`).
- **Environment variables:**

  | Key | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `MONGODB_URI` | the Atlas string from step 1 |
  | `SESSION_SECRET` | `openssl rand -hex 32` |
  | `COMMUNITY_JWT_SECRET` | **must match the main app** (see step 5) |
  | `MAIN_APP_URL` | `https://app.brainjot.space` |
  | `COMMUNITY_APP_URL` | `https://community.brainjot.space` |
  | `ALLOWED_ORIGINS` | `https://community.brainjot.space` |
  | `MONGO_MAX_POOL` | `10` |

- Deploy. Then Settings → Domains → add **`api.community.brainjot.space`**.
- Verify: `https://api.community.brainjot.space/api/health` → `{"status":"ok"}`.

## 3. Frontend → Vercel project `community-frontend`

- New Project → same repo → **Root Directory = `brainjot-community/frontend`**.
- Framework preset: **Vite** (build `npm run build`, output `dist`). The
  `vercel.json` rewrites all routes to `index.html` for SPA deep links.
- **Environment variables:**

  | Key | Value |
  |---|---|
  | `VITE_API_URL` | `https://api.community.brainjot.space` |
  | `VITE_MAIN_APP_URL` | `https://app.brainjot.space` |

- Deploy. Then Settings → Domains → add **`community.brainjot.space`**.

## 4. DNS (your registrar / Cloudflare)

| Record | Name | Target |
|---|---|---|
| CNAME | `community` | `cname.vercel-dns.com` (Vercel shows the exact value) |
| CNAME | `api.community` | `cname.vercel-dns.com` |

## 5. Main app — set the shared secret (one-time)

The main app already has the SSO endpoint, CORS origin, and Community button.
It just needs the secret so it can mint SSO tokens:

- In the **main app's** Vercel backend project → add env var
  `COMMUNITY_JWT_SECRET` = **the same value** you set in step 2 → redeploy.

Generate it once and use the identical value in both places:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 6. Smoke test

1. Log into the main app at `app.brainjot.space`.
2. Click the **Community** button (next to search) → lands on
   `community.brainjot.space`, **already logged in** (SSO), account auto-created
   with your main-app username.
3. Create a post, upvote, comment. Open a profile → Message → send a DM (the other
   side sees it within ~2.5s via polling).

---

## Operating notes

- **Polling cost is the community's scaling ceiling** (not the main app's). Each
  open chat polls every ~2.5s; the unread badge every 30s. Fine at MVP volume.
- **When you outgrow it:** move *this backend* to a websocket-capable host
  (Railway/Render/Fly), set `REDIS_URL`, and swap `Conversation.jsx` + the App
  badge back to sockets. The session/rate-limit stores already switch to Redis via
  that one env var. The main app is unaffected by any of this.
- **Connection limits:** `MONGO_MAX_POOL=10` keeps per-instance pools small so
  many concurrent Vercel instances don't exhaust Atlas. Raise your Atlas tier
  before raising this.
