const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler } = require('../utils');
const { MAX_UPLOAD_BYTES, presignPut } = require('../lib/storage');

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.DISABLE_RATE_LIMIT,
  message: { error: 'rate_limited' }
});

const schema = z.object({
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().positive()
});

router.post('/presign', uploadLimiter, requireAuth, validateBody(schema), asyncHandler(async (req, res) => {
  const { bytes, content_type: contentType } = req.valid.body;
  if (bytes > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'payload_too_large' });
  const result = await presignPut(req.user.id, contentType, bytes);
  return res.status(200).json(result);
}));

module.exports = router;
