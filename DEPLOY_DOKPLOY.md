# Deploying brainjot Community on Dokploy

Two separate Dokploy "Application" services (backend + frontend) connected to your
existing MongoDB Atlas cluster.

```
community.brainjot.space      → Dokploy: brainjot-community-frontend  (Nginx + Vite build)
api.community.brainjot.space  → Dokploy: brainjot-community-backend   (Node.js/Express)
                              → MongoDB Atlas: SEPARATE cluster (isolation)
```

---

## Prerequisites

- Dokploy installed on a VPS (DigitalOcean, Hetzner, etc.)
- Your GitHub repo connected to Dokploy
- A domain (e.g. `brainjot.space`) with DNS you can edit
- MongoDB Atlas cluster (separate from your main app) — see step 1 below

---

## Step 1 — MongoDB Atlas (separate cluster)

1. Create a **new Atlas project** (not the main app's) → free **M0** cluster.
2. **Database Access** → Add user (e.g. `community`) with a strong password.
3. **Network Access** → `0.0.0.0/0` (Dokploy VPS IP is static — you can restrict later).
4. Copy the connection string:
   ```
   mongodb+srv://community:<pw>@<cluster>/brainjot_community?retryWrites=true&w=majority
   ```

---

## Step 2 — Deploy the Backend

### 2a. Create the Application in Dokploy

1. Open Dokploy → **Projects** → select/create a project → **Create Service → Application**.
2. **Name**: `brainjot-community-backend`
3. **Source**: GitHub → select your repo → Branch: `main`
4. **Build Type**: `Dockerfile`
5. **Dockerfile path**: `backend/Dockerfile`
6. **Docker context**: `backend`

### 2b. Set Environment Variables

In the service → **Environment** tab, add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `MONGODB_URI` | The Atlas URI from step 1 |
| `SESSION_SECRET` | run: `openssl rand -hex 32` |
| `COMMUNITY_JWT_SECRET` | Same value used in your main app (see step 5) |
| `MAIN_APP_URL` | `https://app.brainjot.space` |
| `COMMUNITY_APP_URL` | `https://community.brainjot.space` |
| `ALLOWED_ORIGINS` | `https://community.brainjot.space` |
| `MONGO_MAX_POOL` | `20` |
| `REDIS_URL` | leave blank unless you add Redis later |

R2 uploads (optional) — add these only if you want file uploads:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

### 2c. Configure the Domain

1. **Domains** tab → **Add Domain**
2. **Host**: `api.community.brainjot.space`
3. **Port**: `4000`
4. Enable **HTTPS** (Dokploy auto-provisions Let's Encrypt)
5. Click **Save**

### 2d. Deploy and Verify

1. Click **Deploy** (or push to your repo — auto-deploy triggers).
2. Watch **Logs** — you should see:
   ```
   [startup] community API on :4000
   ```
3. Verify health check:
   ```bash
   curl https://api.community.brainjot.space/api/health
   # output: {"status":"ok"}
   ```

---

## Step 3 — Deploy the Frontend

### 3a. Create the Application in Dokploy

1. Dokploy → same project → **Create Service → Application**
2. **Name**: `brainjot-community-frontend`
3. **Source**: Same GitHub repo → Branch: `main`
4. **Build Type**: `Dockerfile`
5. **Dockerfile path**: `frontend/Dockerfile`
6. **Docker context**: `frontend`

### 3b. Set Build Arguments

**Critical**: Vite bakes `VITE_*` variables into the JS bundle at **build time**.
They must be set as **Build Arguments** (not just runtime env vars) in Dokploy.

In the service → **Build** tab → **Build Arguments**:

| Argument | Value |
|---|---|
| `VITE_API_URL` | `https://api.community.brainjot.space` |
| `VITE_MAIN_APP_URL` | `https://app.brainjot.space` |
| `VITE_MAIN_API_URL` | your main app backend URL, or leave blank |

### 3c. Configure the Domain

1. **Domains** tab → **Add Domain**
2. **Host**: `community.brainjot.space`
3. **Port**: `80`
4. Enable **HTTPS**
5. Click **Save**

### 3d. Deploy and Verify

1. Click **Deploy**.
2. Visit `https://community.brainjot.space` — should load the React app.

---

## Step 4 — DNS (Cloudflare / your registrar)

Point both subdomains to your Dokploy VPS IP:

| Type | Name | Value |
|---|---|---|
| `A` | `community` | your Dokploy VPS IP |
| `A` | `api.community` | your Dokploy VPS IP |

If using Cloudflare, set **DNS only** (grey cloud) initially so Let's Encrypt can
issue the TLS certificate. Switch to Proxied (orange) afterwards if you want.

---

## Step 5 — Main App: Share the SSO Secret (one-time)

The community backend verifies SSO tokens minted by the main app. They share one secret.

1. Generate the secret once:
   ```bash
   openssl rand -hex 32
   ```
2. Set `COMMUNITY_JWT_SECRET` to that value in **both**:
   - This community backend (done in step 2b)
   - Your main app's backend (wherever it's deployed)
3. Redeploy the main app backend so the new env var is live.

---

## Step 6 — Smoke Test

1. Log into your main app at `https://app.brainjot.space`.
2. Click the **Community** button → should land on `community.brainjot.space` already logged in (SSO).
3. Create a post, upvote, comment, send a DM.
4. Check backend logs in Dokploy for any errors.

---

## Auto-Deploy on Git Push

In each Dokploy service → **General** tab → enable **Auto Deploy**.
Every push to `main` will rebuild + redeploy automatically.

---

## Scaling Notes

| Scenario | Action |
|---|---|
| More traffic | Increase Replicas in Dokploy (backend is stateless if `REDIS_URL` is set) |
| Session sharing across replicas | Add a Redis service in Dokploy, set `REDIS_URL` |
| Atlas connection limits | Raise Atlas tier + increase `MONGO_MAX_POOL` |
| WebSockets (future) | Backend already supports it; enable sticky sessions in Dokploy's proxy |

---

## Troubleshooting

| Problem | Check |
|---|---|
| `{"error":"Service temporarily unavailable"}` | MongoDB URI wrong or Atlas Network Access blocking the VPS IP |
| Login loop / cookie rejected | `COMMUNITY_JWT_SECRET` mismatch between main app and community backend |
| Frontend shows blank page | `VITE_API_URL` build arg not set; must rebuild the frontend container |
| CORS errors in browser | `ALLOWED_ORIGINS` does not include your frontend domain |
| SSL cert not issued | DNS has not propagated yet; wait a few minutes and retry |
