import DOMPurify from 'dompurify';

// Defense in depth: the backend already sanitizes on write, we sanitize again on
// render. Links open safely in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function cleanHtml(html) {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'img', 'hr', 'span'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'class'],
  });
}

export function timeAgo(date) {
  const d = new Date(date);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

// Route to a user's profile. Main-app usernames are optional, so fall back to
// the user id (the API resolves either). Returns null when there's no target
// at all — callers should render plain text instead of a dead link.
export function profilePath(user) {
  const handle = user?.username || user?.id;
  return handle ? `/u/${handle}` : null;
}

// Max visible characters for post and comment bodies — mirrors the backend cap.
export const BODY_MAX = 500;

const TYPE_LABELS = {
  discussion: { label: 'Discussion', color: '#6366f1' },
  showcase: { label: 'Showcase', color: '#10b981' },
  question: { label: 'Question', color: '#f59e0b' },
  collab: { label: 'Collab', color: '#ec4899' },
};
export function typeMeta(type) {
  return TYPE_LABELS[type] || TYPE_LABELS.discussion;
}

export const COMP_LABELS = {
  paid: 'Paid', equity: 'Equity', unpaid: 'Unpaid', negotiable: 'Negotiable',
};
export const COMMITMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', one_off: 'One-off', flexible: 'Flexible',
};
