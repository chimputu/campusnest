const express = require('express');
const { z } = require('zod');
const pool = require('../config/db');
const { optionalAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler, idParam, httpError, isUnique } = require('../utils');
const { displayName } = require('../lib/helpers');

const router = express.Router({ mergeParams: true });

const createSchema = z.object({
  stars: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().max(1000).optional()
});

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const listingId = idParam(req.params.listingId);
  const { rows: listing } = await pool.query('SELECT id, landlord_id, status FROM listings WHERE id = $1', [listingId]);
  if (!listing.length) return res.status(404).json({ error: 'not_found' });
  const privileged = req.user && (req.user.role === 'ADMIN' || req.user.id === listing[0].landlord_id);
  if (!privileged && !['ACTIVE', 'FULL'].includes(listing[0].status)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const { rows } = await pool.query(
    `SELECT v.stars, v.body, v.created_at, u.full_name AS reviewer_name
       FROM reviews v JOIN users u ON u.id = v.tenant_id
      WHERE v.listing_id = $1 ORDER BY v.created_at DESC`,
    [listingId]
  );
  return res.status(200).json({
    reviews: rows.map((r) => ({ stars: r.stars, body: r.body, created_at: r.created_at, reviewer: displayName(r.reviewer_name) }))
  });
}));

router.post('/', requireRole('TENANT'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const listingId = idParam(req.params.listingId);
  const b = req.valid.body;
  const { rows: eligible } = await pool.query(
    "SELECT id FROM requests WHERE tenant_id = $1 AND listing_id = $2 AND status IN ('ACCEPTED','COMPLETED')",
    [req.user.id, listingId]
  );
  if (!eligible.length) throw httpError(403, 'not_eligible');
  try {
    const { rows } = await pool.query(
      'INSERT INTO reviews (listing_id, tenant_id, stars, body, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [listingId, req.user.id, b.stars, b.body || null]
    );
    return res.status(201).json({ review: rows[0] });
  } catch (err) {
    if (isUnique(err, 'reviews_one_per_tenant_listing')) throw httpError(409, 'already_reviewed');
    throw err;
  }
}));

module.exports = router;
