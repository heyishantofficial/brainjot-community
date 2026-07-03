import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
export const MAIN_APP_URL = (import.meta.env.VITE_MAIN_APP_URL || 'https://app.brainjot.space').replace(/\/+$/, '');

// withCredentials → the community session cookie rides along on every request.
export const api = axios.create({ baseURL: API_URL + '/api', withCredentials: true });

// ── SSO bootstrap ────────────────────────────────────────────────────────────
// 1. Ask the community backend who we are (/auth/me).
// 2. If unauthenticated, silently try to mint a token from the MAIN APP
//    (/api/community/sso-token, sent with credentials → uses the main app's
//    existing login cookie). This is the ONLY call we ever make to the main app.
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
    const tokenRes = await axios.get(`${MAIN_APP_URL}/api/community/sso-token`, { withCredentials: true });
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
