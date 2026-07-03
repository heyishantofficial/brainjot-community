// ── Hot ranking ──────────────────────────────────────────────────────────────
// Reddit-style "hot" score: a post's rank is a function of its net votes and its
// age, so good posts rise fast and then decay. We precompute and STORE this on the
// post (post.hotScore) and recompute it only when a vote changes — never at read
// time. The feed query is then a single indexed sort on {hotScore: -1, _id: -1},
// which scales to millions of rows because the DB just walks the index.
//
// This is the pull/"rank-on-read-but-precomputed" model. It scales far further
// than X-style fan-out-on-write timelines before needing any extra infrastructure.

// Epoch anchor — keeps hotScore numbers in a sane range. (Reddit used 2005;
// we use the project's birth year. Any fixed constant works.)
const EPOCH_SECONDS = Date.UTC(2024, 0, 1) / 1000;

// Gravity: higher = faster decay. ~12.5h half-life feel at gravity 1.8.
const GRAVITY = 1.8;

function hotScore(upvotes, downvotes, createdAt = new Date()) {
  const score = upvotes - downvotes;
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  const seconds = createdAt.getTime() / 1000 - EPOCH_SECONDS;
  // Time term grows linearly; the log() of votes means each order of magnitude
  // of votes is worth a fixed time bonus.
  return Number((sign * order + seconds / (45000 * GRAVITY)).toFixed(7));
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

module.exports = { hotScore, confidence };
