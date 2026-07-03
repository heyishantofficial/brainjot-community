// Curated topic list to seed the community. Freeform tags are also allowed, but
// these get first-class filter chips in the UI. Keep slugs short + lowercase.
const TOPICS = [
  { slug: 'showcase', label: 'Showcase', emoji: '🚀' },
  { slug: 'hiring', label: 'Hiring', emoji: '💼' },
  { slug: 'looking-for-work', label: 'Looking for work', emoji: '👋' },
  { slug: 'discussion', label: 'Discussion', emoji: '💬' },
  { slug: 'feedback', label: 'Feedback', emoji: '🔍' },
  { slug: 'questions', label: 'Questions', emoji: '❓' },
  { slug: 'design', label: 'Design', emoji: '🎨' },
  { slug: 'engineering', label: 'Engineering', emoji: '⚙️' },
  { slug: 'product', label: 'Product', emoji: '📦' },
  { slug: 'marketing', label: 'Marketing', emoji: '📣' },
];

const TOPIC_SLUGS = new Set(TOPICS.map((t) => t.slug));

// Normalize a freeform tag into a slug.
function normalizeTopic(t) {
  return String(t || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30);
}

module.exports = { TOPICS, TOPIC_SLUGS, normalizeTopic };
