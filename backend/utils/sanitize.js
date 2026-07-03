const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// Server-side HTML sanitization for user-generated post/comment bodies.
// All UGC is rendered as HTML, so it MUST be sanitized on the way IN (defense in
// depth — the frontend also sanitizes on render). We allow a small, safe subset
// suitable for posts: basic formatting, links, lists, code, images, blockquotes.
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const ALLOWED_TAGS = [
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
  'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'img', 'hr', 'span',
];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'src', 'alt', 'class'];

function sanitizeHtml(dirty) {
  if (typeof dirty !== 'string') return '';
  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
  return clean.trim();
}

// Plain-text fields (titles, usernames in snapshots): strip all tags + clamp.
function sanitizeText(str, max = 300) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Visible-character count of an HTML body: what the USER typed, ignoring markup
// overhead (<p> wrappers) and counting escaped entities (&amp;) as one char.
// Used to enforce honest length limits — a 500-char cap measured on raw HTML
// would reject users short of 500 because of invisible markup.
function plainTextLength(html) {
  if (typeof html !== 'string') return 0;
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#0?39|nbsp);/g, 'x')
    .length;
}

module.exports = { sanitizeHtml, sanitizeText, plainTextLength };
