// ── OG share previews for /post/:id ─────────────────────────────────────────
// The SPA is static, so a shared link would normally show a blank card on
// WhatsApp/X/LinkedIn/Slack. This function serves the SAME index.html but with
// the post's title/description injected into <head>, so every share unfurls
// into a rich card. Works for crawlers and humans alike (humans just get the
// normal app — React takes over after load).
//
// Wired via vercel.json rewrite: /post/:id → /api/post?id=:id

const ID_RE = /^[a-f0-9]{24}$/i;

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = `https://${host}`;
  const apiUrl = (process.env.VITE_API_URL || 'https://api.community.brainjot.space').replace(/\/+$/, '');

  // Always serve the real SPA shell; meta injection is best-effort on top.
  let html;
  try {
    html = await (await fetch(`${base}/index.html`)).text();
  } catch {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }

  try {
    if (ID_RE.test(id)) {
      const r = await fetch(`${apiUrl}/api/posts/${id}`);
      if (r.ok) {
        const { post } = await r.json();
        const title = esc(post.title);
        const desc = esc(stripTags(post.body).slice(0, 160)) ||
          'Join the conversation on brainjot Community.';
        const image = post.media?.find((m) => m.type === 'image')?.url;
        const url = `${base}/post/${id}`;
        const meta = [
          `<meta property="og:type" content="article">`,
          `<meta property="og:site_name" content="brainjot Community">`,
          `<meta property="og:title" content="${title}">`,
          `<meta property="og:description" content="${desc}">`,
          `<meta property="og:url" content="${url}">`,
          image ? `<meta property="og:image" content="${esc(image)}">` : '',
          `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
          `<meta name="twitter:title" content="${title}">`,
          `<meta name="twitter:description" content="${desc}">`,
          image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
          `<meta name="description" content="${desc}">`,
        ].filter(Boolean).join('\n    ');
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${title} · brainjot Community</title>`)
          .replace('</head>', `    ${meta}\n  </head>`);
      }
    }
  } catch { /* fall through with unmodified shell */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cache at the edge briefly — crawler bursts (a post going viral in a group
  // chat) hit the CDN, not the API.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  res.statusCode = 200;
  res.end(html);
}
