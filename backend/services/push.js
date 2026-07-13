const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const logger = require('../utils/logger');

// Web Push (VAPID). Disabled gracefully when keys are missing — GET /push/key
// returns null and the frontend never subscribes.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:verify@brainjot.space';

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  logger.warn('[push] VAPID keys not configured — web push disabled');
}

// Mirrors the wording + deep links of the Notifications page (TYPE_META /
// notifTarget in pages/Notifications.jsx). URLs are relative to the community
// frontend origin — that's where the service worker lives.
const TYPE_LABELS = {
  comment: 'commented on your post',
  reply: 'replied to your comment',
  mention: 'mentioned you',
  collab_request: 'sent you a collab request',
  collab_accepted: 'accepted your collab request',
};

function pushPayloadFor({ type, actor, postId, conversationId, snippet }) {
  const who = actor?.name || 'Someone';
  let url = '/notifications';
  if ((type === 'collab_request' || type === 'collab_accepted') && conversationId) url = `/messages/${conversationId}`;
  else if (postId) url = `/post/${postId}`;
  return {
    title: `${who} ${TYPE_LABELS[type] || 'sent you a notification'}`,
    body: snippet || '',
    url,
    tag: `${type}:${conversationId || postId || ''}`,
  };
}

// Send a payload to every subscription a user has. 404/410 from the push
// service = dead subscription (browser reset, permission revoked) — delete it.
// Never throws: push failure must not fail the comment/message that caused it.
async function sendPushToUser(userId, payload) {
  if (!pushEnabled || !userId) return;
  try {
    const subs = await PushSubscription.find({ userId }).lean();
    if (!subs.length) return;
    const json = JSON.stringify(payload);
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, json, { TTL: 24 * 60 * 60 });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        } else {
          logger.warn({ statusCode: err.statusCode, userId }, '[push] send failed (non-fatal)');
        }
      }
    }));
  } catch (err) {
    logger.warn({ err }, '[push] sendPushToUser failed (non-fatal)');
  }
}

module.exports = { pushEnabled, VAPID_PUBLIC_KEY, pushPayloadFor, sendPushToUser };
