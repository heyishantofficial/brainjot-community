const mongoose = require('mongoose');

// ── Cursor pagination ────────────────────────────────────────────────────────
// We NEVER use offset/.skip() for feeds. Offset pagination re-scans every skipped
// document, so page 500 of a viral thread would scan 500*pageSize docs on every
// request. Cursor pagination instead seeks directly via an indexed range, so cost
// is constant regardless of how deep the user scrolls. This is a one-way door:
// baking offset into the API + frontend is painful to rip out later, so we start
// correct.
//
// A cursor is just an opaque, base64 encoding of the last item's sort key(s).
// For ObjectId-based feeds the _id already encodes creation time, so a single
// {_id: {$lt: cursor}} seek gives a stable, gap-free "newest first" page.

function encodeCursor(value) {
  if (value == null) return null;
  return Buffer.from(String(value)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return Buffer.from(String(cursor), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

// Decode a cursor that points at an ObjectId (the common case).
function decodeIdCursor(cursor) {
  const raw = decodeCursor(cursor);
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Run a cursor query that has already been built with .limit(limit + 1) applied,
// and split the extra "lookahead" doc into a nextCursor. `keyFn` extracts the
// cursor key from the last returned document.
function buildPage(docs, limit, keyFn) {
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(keyFn(last)) : null,
    hasMore,
  };
}

module.exports = {
  encodeCursor,
  decodeCursor,
  decodeIdCursor,
  clampLimit,
  buildPage,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
