# Deploying brainjot Community

Two Dokploy services (static frontend + Node backend) on the Hostinger VPS,
plus a MongoDB database that is **separate** from the main app's.

```
community.brainjot.space      → Dokploy service: community-frontend (static Vite build)
api.community.brainjot.space  → Dokploy service: community-backend  (Node/Express, long-running)
                              → MongoDB: SEPARATE database/cluster (isolation)
```

The backend lives on `api.community.brainjot.space` (a brainjot.space subdomain),
so the session cookie stays first-party and Safari/Brave don't block it.

---

## 1. MongoDB (separate from the main app)

1. Create a **separate database** (own cluster on Atlas, or its own MongoDB
   instance/container on the VPS) — not the main app's.
2. Create a dedicated user (e.g. `community`) with a strong password.
3. If using Atlas, allow the VPS's IP in Network Access (better than `0.0.0.0/0`).
4. Connection string →
   `mongodb+srv://community:<pw>@<cluster>/brainjot_community?retryWrites=true&w=majority`
   (or `mongodb://...` for a local instance).

> This separation is the isolation guarantee — a community spike can never
> touch the main app's database.

## 2. Backend → Dokploy service `community-backend`

- New Application → point at the repo → **build path `brainjot-community/backend`**.
- Start command: `node server.js` (a normal long-running server).
- **Environment variables:**

  | Key | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `PORT` | whatever port the service exposes (defaults to `4000`) |
  | `MONGODB_URI` | the connection string from step 1 |
  | `SESSION_SECRET` | `openssl rand -hex 32` |
  | `COMMUNITY_JWT_SECRET` | **must match the main app** (see step 5) |
  | `MAIN_APP_URL` | `https://app.brainjot.space` |
  | `COMMUNITY_APP_URL` | `https://community.brainjot.space` |
  | `ALLOWED_ORIGINS` | `https://community.brainjot.space` |
  | `MONGO_MAX_POOL` | `10` |

- Deploy, then add the domain **`api.community.brainjot.space`** to the service
  (Dokploy/Traefik provisions the TLS certificate).
- Verify: `https://api.community.brainjot.space/api/health` → `{"status":"ok"}`.

## 3. Frontend → Dokploy service `community-frontend`

- New Application → same repo → **build path `brainjot-community/frontend`**.
- Build: `npm run build`, serve the `dist/` output as a static site. Make sure
  unknown routes fall back to `index.html` (SPA deep links) — e.g. nginx
  `try_files $uri $uri/ /index.html;`.
- **Build-time environment variables** (Vite inlines these at build):

  | Key | Value |
  |---|---|
  | `VITE_API_URL` | `https://api.community.brainjot.space` |
  | `VITE_MAIN_APP_URL` | `https://app.brainjot.space` |

- Deploy, then add the domain **`community.brainjot.space`**.

## 4. DNS (your registrar / Cloudflare)

| Record | Name | Target |
|---|---|---|
| A | `community` | the VPS IP |
| A | `api.community` | the VPS IP |

## 5. Main app — set the shared secret (one-time)

The main app already has the SSO endpoint, CORS origin, and Community button.
It just needs the secret so it can mint SSO tokens:

- In the **main app's** backend service on Dokploy → add env var
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
- **Websockets are now an option:** the backend runs as a long-lived process on
  the VPS, so you can add Socket.io, set `REDIS_URL`, and swap `Conversation.jsx`
  + the App badge from polling to sockets whenever DM volume justifies it. The
  session/rate-limit stores already switch to Redis via that one env var.
- **OG share previews:** the old serverless `/post/:id` meta-tag injector was
  removed with the Vercel setup. If rich link unfurls matter, reimplement it as
  a route on the community backend (fetch post → inject `<meta>` into the SPA
  shell) and route crawler traffic for `/post/:id` to it.
- **Connection limits:** `MONGO_MAX_POOL=10` keeps the pool modest; raise it
  only alongside your MongoDB tier/instance size.
