const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler } = require('../utils');
const { presignPut } = require('../lib/storage');

const router = express.Router();

const schema = z.object({
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp'])
});

router.post('/presign', requireAuth, validateBody(schema), asyncHandler(async (req, res) => {
  const result = await presignPut(req.user.id, req.valid.body.content_type);
  return res.status(200).json(result);
}));

module.exports = router;
