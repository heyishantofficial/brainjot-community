import posthog from 'posthog-js';

// ── Product analytics (PostHog) ──────────────────────────────────────────────
// Safe no-op when VITE_POSTHOG_KEY is unset, so dev/preview builds never send.
// Same conventions as the main app's analytics.js: past-tense snake_case
// events, never any content or emails in properties — only ids/enums/counts.

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY || '').trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let enabled = false;

export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage+cookie',
    disable_session_recording: true,
    mask_all_text: true,
  });
  enabled = true;
}

// User ids are shared with the main app (SSO), so identifying with the same id
// means PostHog sees one person across both products.
export function identifyUser(user) {
  if (!enabled || !user?.id) return;
  posthog.identify(String(user.id), {
    username: user.username,
    role: user.role || 'user',
    app: 'community',
  });
}

export function resetAnalytics() {
  if (!enabled) return;
  posthog.reset();
}

export function track(event, properties = {}) {
  if (!enabled) return;
  posthog.capture(event, properties);
}
