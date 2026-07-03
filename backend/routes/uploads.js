const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

const router = express.Router();

// ── Image uploads via Cloudflare R2 presigned PUTs ───────────────────────────
// The serverless backend never proxies file bytes (that would burn function
// time and memory). Instead it signs a short-lived PUT URL; the browser uploads
// straight to R2, then attaches the public URL to the post's media[].
//
// Fully optional: when the R2_* env vars are absent, /api/config reports
// uploads:false and the composer simply doesn't show an image button.

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];

function uploadsEnabled() {
  return REQUIRED_ENV.every((k) => !!process.env[k]);
}

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_BYTES = 5 * 1024 * 1024; // 5MB per image

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
    const ext = ALLOWED_TYPES[type];
    if (!ext) return res.status(400).json({ error: 'Only JPEG, PNG, WebP, or GIF images are allowed' });
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_BYTES) {
      return res.status(400).json({ error: 'Images must be under 5MB' });
    }

    const key = `community/img/${crypto.randomBytes(12).toString('base64url')}.${ext}`;
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const uploadUrl = await getSignedUrl(
      getS3(),
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ContentType: type,
        ContentLength: bytes,
      }),
      { expiresIn: 300 },
    );

    res.json({
      uploadUrl,
      publicUrl: `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`,
    });
  } catch (err) {
    logger.error({ err }, '[uploads] sign failed');
    next(err);
  }
});

module.exports = { router, uploadsEnabled };
