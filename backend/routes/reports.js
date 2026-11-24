const express = require('express');
const { z } = require('zod');
const pool = require('../config/db');
const { withTransaction } = require('../config/tx');
const { requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler, idParam, httpError } = require('../utils');
const { notify } = require('../lib/helpers');

const router = express.Router({ mergeParams: true });

const createSchema = z.object({
  reason: z.enum(['FAKE_PHOTOS', 'WRONG_PRICE', 'PROPERTY_FULL', 'HARASSMENT', 'OTHER']),
  body: z.string().trim().max(1000).optional()
});

router.post('/', requireRole('TENANT'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const listingId = idParam(req.params.listingId);
  const b = req.valid.body;
  const created = await withTransaction(async (client) => {
    const { rows: listing } = await client.query(
      "SELECT id FROM listings WHERE id = $1 AND status IN ('ACTIVE','FULL')",
      [listingId]
    );
    if (!listing.length) throw httpError(404, 'not_found');
    const { rows: existing } = await client.query(
      "SELECT id FROM reports WHERE listing_id = $1 AND reporter_id = $2 AND status = 'OPEN'",
      [listingId, req.user.id]
    );
    if (existing.length) throw httpError(409, 'already_reported');
    const { rows } = await client.query(
      `INSERT INTO reports (listing_id, reporter_id, reason, body, status, created_at)
       VALUES ($1, $2, $3, $4, 'OPEN', NOW()) RETURNING *`,
      [listingId, req.user.id, b.reason, b.body || null]
    );
    const { rows: admins } = await client.query("SELECT id FROM users WHERE role = 'ADMIN'");
    for (const admin of admins) {
      await notify(client, admin.id, 'REPORT_RECEIVED', 'Report received', 'A listing was reported.', '#/admin');
    }
    return rows[0];
  });
  return res.status(201).json({ report: created });
}));

module.exports = router;
