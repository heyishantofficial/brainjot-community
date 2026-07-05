import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
// The main app's FRONTEND (login page, dashboard) — used for links/redirects only.
export const MAIN_APP_URL = (import.meta.env.VITE_MAIN_APP_URL || 'https://app.brainjot.space').replace(/\/+$/, '');
// The main app's BACKEND API — a separate Vercel project/domain from the
// frontend above. This is the one that actually serves /api/community/sso-token.
// Falls back to MAIN_APP_URL for setups where frontend+backend share one origin.
export const MAIN_API_URL = (import.meta.env.VITE_MAIN_API_URL || MAIN_APP_URL).replace(/\/+$/, '');

// withCredentials → the community session cookie rides along on every request.
export const api = axios.create({ baseURL: API_URL + '/api', withCredentials: true });

// ── SSO bootstrap ────────────────────────────────────────────────────────────
// 1. Ask the community backend who we are (/auth/me).
// 2. If unauthenticated, silently try to mint a token from the MAIN APP
//    (/api/community/sso-token, sent with credentials → uses the main app's
//    existing login cookie). Besides this, the only other main-app calls are
//    the DM invite dropdown's (fetchMyMainProjects / sendProjectInvite below).
// 3. Exchange that token for a community session.
// 4. If the main app says we're not logged in either, we're a guest.
export async function bootstrapSession() {
  try {
    const { data } = await api.get('/auth/me');
    return data.user;
  } catch {
    /* not logged into community yet — try SSO */
  }

  try {
    const tokenRes = await axios.get(`${MAIN_API_URL}/api/community/sso-token`, { withCredentials: true });
    const token = tokenRes.data?.token;
    if (!token) return null;
    const { data } = await api.post('/auth/sso-login', { token });
    return data.user;
  } catch {
    return null; // guest — not logged into the main app
  }
}

// Send the user to the main app to log in, then back here.
export function redirectToLogin() {
  const ret = encodeURIComponent(window.location.href);
  window.location.href = `${MAIN_APP_URL}/login?redirect=${ret}`;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
}

// Deep link into the main app's existing invite flow (the collab→project bridge).
// We don't auto-provision; we hand the hirer straight to the invite UI.
export function inviteToProjectUrl(username) {
  return `${MAIN_APP_URL}/?invite=${encodeURIComponent(username || '')}`;
}

// ── Direct invite from a DM (the "Invite to project" dropdown) ───────────────
// Both calls hit the MAIN app's API with the main-app session cookie (same
// cross-origin + credentials setup the SSO bootstrap already relies on). If the
// browser has no main-app session, they 401 and the UI falls back to the
// inviteToProjectUrl deep link above.

// The hirer's own projects, for the dropdown: [{ id, title, icon, color }].
export async function fetchMyMainProjects() {
  const { data } = await axios.get(`${MAIN_API_URL}/api/community/my-projects`, { withCredentials: true });
  return data.projects || [];
}

// Invite a community user (by handle — we never see emails) straight into one
// of the hirer's projects. The main app resolves the handle, emails them, and
// drops an in-app collab_invite notification.
export async function sendProjectInvite({ username, projectId, role = 'editor' }) {
  const { data } = await axios.post(
    `${MAIN_API_URL}/api`,
    { username, entityId: projectId, entityType: 'project', role },
    { params: { action: 'send_collab_invite' }, withCredentials: true },
  );
  return data;
}
