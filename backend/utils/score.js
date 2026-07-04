// ── Hot ranking ──────────────────────────────────────────────────────────────
// Reddit-style "hot" score: a post's rank is a function of its engagement and its
// age, so good posts rise fast and then decay. We precompute and STORE this on the
// post (post.hotScore) and recompute it only when engagement changes — never at
// read time. The feed query is then a single indexed sort on {hotScore: -1, _id: -1},
// which scales to millions of rows because the DB just walks the index.
//
// This is the pull/"rank-on-read-but-precomputed" model. It scales far further
// than X-style fan-out-on-write timelines before needing any extra infrastructure.
//
// Engagement is a WEIGHTED blend, not just votes — the shape X's open-sourced
// ranker uses (weighted_scorer.rs: positive actions add, negative actions
// subtract). Ours is deliberately tiny: votes + comments − reports.

// A comment is worth more than an upvote: writing a reply costs far more effort
// than clicking an arrow, so it's a stronger signal the post is interesting.
// (X weighs replies ~an order of magnitude over likes; forums are calmer, so 3×.)
const COMMENT_WEIGHT = 3;

// A report is strongly negative: a reported post should sink well before a
// moderator gets to it. One report cancels ~10 upvotes. Dismissed reports give
// the penalty back (see routes/reports.js).
const REPORT_WEIGHT = 10;

// Epoch anchor — keeps hotScore numbers in a sane range. (Reddit used 2005;
// we use the project's birth year. Any fixed constant works.)
const EPOCH_SECONDS = Date.UTC(2024, 0, 1) / 1000;

// Gravity: higher = faster decay. ~12.5h half-life feel at gravity 1.8.
const GRAVITY = 1.8;

// Unit cheat-sheet: 1.0 hotScore unit == 45000*GRAVITY seconds (22.5h) of age
// == one order of magnitude (10×) of net engagement.

function engagement({ upvotes = 0, downvotes = 0, commentCount = 0, reportCount = 0 }) {
  return (upvotes - downvotes) + COMMENT_WEIGHT * commentCount - REPORT_WEIGHT * reportCount;
}

// `post` needs {upvotes, downvotes, commentCount, reportCount, createdAt}.
// Missing fields count as 0 / now, so a fresh {createdAt} seed works.
function hotScore(post) {
  const eng = engagement(post);
  const order = Math.log10(Math.max(Math.abs(eng), 1));
  const sign = eng > 0 ? 1 : eng < 0 ? -1 : 0;
  const createdAt = post.createdAt ? new Date(post.createdAt) : new Date();
  const seconds = createdAt.getTime() / 1000 - EPOCH_SECONDS;
  // Time term grows linearly; the log() of engagement means each order of
  // magnitude of engagement is worth a fixed time bonus.
  return Number((sign * order + seconds / (45000 * GRAVITY)).toFixed(7));
}

// ── Author diversity ─────────────────────────────────────────────────────────
// One prolific author shouldn't own the front page. Same idea as X's
// author_diversity_scorer.rs (attenuate an author's 2nd, 3rd… post within a
// single response), adapted to our score: X multiplies pure-engagement scores,
// but ours is time-anchored, so a multiplier would hurl a post back months.
// Instead we SUBTRACT a fixed penalty per repeat — each repeat ranks as if the
// post were ~5.6h older (0.25 unit × 22.5h/unit).
//
// Applied per PAGE at read time, after the cursor is computed from the raw
// index order — so pagination stays exact and nothing is ever skipped, pages
// are just reordered internally.
const AUTHOR_DIVERSITY_PENALTY = 0.25;

function diversifyByAuthor(items, penalty = AUTHOR_DIVERSITY_PENALTY) {
  if (items.length < 2) return items;
  const seen = new Map(); // authorId → how many of their posts rank above
  const adjusted = items.map((item, idx) => {
    const n = seen.get(item.authorId) || 0;
    seen.set(item.authorId, n + 1);
    return { item, idx, score: (item.hotScore || 0) - penalty * n };
  });
  // Stable: equal adjusted scores keep their original relative order.
  adjusted.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return adjusted.map((a) => a.item);
}

// "Confidence sort" (Wilson lower bound) — best for comment ranking where you
// want quality, not recency. Optional; used for "Top" comment sort.
function confidence(upvotes, downvotes) {
  const n = upvotes + downvotes;
  if (n === 0) return 0;
  const z = 1.281551565545; // 80% confidence
  const p = upvotes / n;
  const left = p + (z * z) / (2 * n);
  const right = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  const under = 1 + (z * z) / n;
  return Number(((left - right) / under).toFixed(7));
}

module.exports = { hotScore, engagement, diversifyByAuthor, confidence };
