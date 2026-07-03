const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

const router = express.Router();

// ── Attachment uploads via Cloudflare R2 presigned PUTs ──────────────────────
// The serverless backend never proxies file bytes (that would burn function
// time and memory). Instead it signs a short-lived PUT URL; the browser uploads
// straight to R2, then attaches the public URL to the post's media[].
//
// Fully optional: when the R2_* env vars are absent, /api/config reports
// uploads:false and the composer simply doesn't show an attach button.
//
// Env var names match the MAIN APP's exactly (R2_ACCOUNT_ID, R2_BUCKET_NAME,
// etc.) so the same Cloudflare R2 account/bucket can be reused — files just
// live under a separate `community/` key prefix, no overlap with the main
// app's own uploads (avatars, project files).

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];

function uploadsEnabled() {
  return REQUIRED_ENV.every((k) => !!process.env[k]);
}

// Images render inline in the feed; PDFs are a common "attach my resume/deck"
// case for collab posts, so they get a larger ceiling than photos.
const ALLOWED_TYPES = {
  'image/jpeg': { ext: 'jpg', kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/png': { ext: 'png', kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/webp': { ext: 'webp', kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/gif': { ext: 'gif', kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'application/pdf': { ext: 'pdf', kind: 'file', maxBytes: 15 * 1024 * 1024 },
};

let s3 = null;
function getS3() {
  if (s3) return s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return s3;
}

// ── POST /api/uploads/sign ───────────────────────────────────────────────────
router.post('/sign', writeLimiter, requireAuth, async (req, res, next) => {
  try {
    if (!uploadsEnabled()) return res.status(503).json({ error: 'Uploads are not enabled' });
    const { type, size } = req.body || {};
    const spec = ALLOWED_TYPES[type];
    if (!spec) return res.status(400).json({ error: 'Only JPEG, PNG, WebP, GIF images or PDF documents are allowed' });
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > spec.maxBytes) {
      return res.status(400).json({ error: `File is too large (max ${Math.round(spec.maxBytes / 1024 / 1024)}MB)` });
    }

    const folder = spec.kind === 'image' ? 'img' : 'files';
    const key = `community/${folder}/${crypto.randomBytes(12).toString('base64url')}.${spec.ext}`;
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const uploadUrl = await getSignedUrl(
      getS3(),
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: type,
        ContentLength: bytes,
      }),
      { expiresIn: 300 },
    );

    res.json({
      uploadUrl,
      publicUrl: `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`,
      kind: spec.kind,
    });
  } catch (err) {
    logger.error({ err }, '[uploads] sign failed');
    next(err);
  }
});

module.exports = { router, uploadsEnabled };
