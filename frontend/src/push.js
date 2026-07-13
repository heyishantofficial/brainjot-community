// Web Push subscription management. The service worker (public/sw.js) lives on
// THIS origin and shows the notifications; the subscription is stored via the
// community API (cross-origin, rides the session cookie like every other call).
import { api } from './api';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The Push API wants the VAPID key as a Uint8Array, not base64url.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribeAndSync() {
  const { data } = await api.get('/notifications/push/key');
  if (!data?.key) return false; // push not configured on the server
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.key),
  });
  await api.post('/notifications/push/subscribe', { subscription: sub.toJSON() });
  return true;
}

// Prompt for permission (user-gesture context, e.g. the enable button on the
// Notifications page) and subscribe this browser.
export async function enablePush() {
  if (!pushSupported()) return false;
  if (Notification.permission === 'denied') return false;
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return false;
  try {
    return await subscribeAndSync();
  } catch (e) {
    console.warn('[community] push subscribe failed:', e);
    return false;
  }
}

// Silent re-sync on app load for returning sessions — never prompts.
export async function syncPushIfGranted() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    await subscribeAndSync();
  } catch (e) {
    console.warn('[community] push sync failed:', e);
  }
}
