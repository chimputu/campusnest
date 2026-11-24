const express = require('express');
const { z } = require('zod');
const pool = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { validateBody, validateQuery } = require('../middleware/validate');
const { asyncHandler, httpError, idParam } = require('../utils');
const { notify, displayName } = require('../lib/helpers');

const router = express.Router();

router.use(requireRole('ADMIN'));

const landlordQuerySchema = z.object({
  verified: z.enum(['true', 'false']).optional()
});

const reportQuerySchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED']).optional().default('OPEN')
});

const suspendSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const resolveSchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED', 'ACTIONED'])
});

router.get('/stats', asyncHandler(async (req, res) => {
  const sql = {
    active_tenants: "SELECT COUNT(*)::int AS n FROM users WHERE role = 'TENANT' AND account_status = 'ACTIVE'",
    verified_landlords: "SELECT COUNT(*)::int AS n FROM users WHERE role = 'LANDLORD' AND landlord_verified = TRUE",
    active_listings: "SELECT COUNT(*)::int AS n FROM listings WHERE status = 'ACTIVE'",
    open_reports: "SELECT COUNT(*)::int AS n FROM reports WHERE status = 'OPEN'",
    pending_verifications: "SELECT COUNT(*)::int AS n FROM users WHERE role = 'LANDLORD' AND landlord_verified = FALSE AND account_status = 'ACTIVE'"
  };
  const result = {};
  for (const [key, query] of Object.entries(sql)) {
    const { rows } = await pool.query(query);
    result[key] = rows[0].n;
  }
  return res.status(200).json(result);
}));

router.get('/landlords', validateQuery(landlordQuerySchema), asyncHandler(async (req, res) => {
  const verified = req.valid.query.verified;
  const params = [];
  let where = "u.role = 'LANDLORD'";
  if (verified !== undefined) {
    params.push(verified === 'true');
    where += ` AND u.landlord_verified = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.account_status, u.landlord_verified,
            (SELECT COUNT(*)::int FROM listings l WHERE l.landlord_id = u.id AND l.status <> 'REMOVED') AS listing_count
       FROM users u WHERE ${where} ORDER BY u.created_at DESC`,
    params
  );
  return res.status(200).json({ landlords: rows });
}));

router.post('/landlords/:id/verify', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    "UPDATE users SET landlord_verified = TRUE WHERE id = $1 AND role = 'LANDLORD' RETURNING *",
    [id]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  await notify(pool, id, 'LANDLORD_VERIFIED', 'Landlord verified', 'Your account has been verified.', '#/dashboard');
  return res.status(200).json({ user: rows[0] });
}));

router.post('/landlords/:id/unverify', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    "UPDATE users SET landlord_verified = FALSE WHERE id = $1 AND role = 'LANDLORD' RETURNING *",
    [id]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  return res.status(200).json({ user: rows[0] });
}));

router.post('/users/:id/suspend', validateBody(suspendSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    `UPDATE users SET account_status = 'SUSPENDED', suspended_reason = $2
      WHERE id = $1 AND role <> 'ADMIN' RETURNING *`,
    [id, req.valid.body.reason]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  await notify(pool, id, 'ACCOUNT_SUSPENDED', 'Account suspended', 'Your account has been suspended.', null);
  return res.status(200).json({ user: rows[0] });
}));

router.post('/users/:id/reactivate', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    `UPDATE users SET account_status = 'ACTIVE', suspended_reason = NULL
      WHERE id = $1 AND role <> 'ADMIN' RETURNING *`,
    [id]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  return res.status(200).json({ user: rows[0] });
}));

router.get('/reports', validateQuery(reportQuerySchema), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT rp.*, l.title AS listing_title, u.full_name AS reporter_name
       FROM reports rp
       JOIN listings l ON l.id = rp.listing_id
       JOIN users u ON u.id = rp.reporter_id
      WHERE rp.status = $1 ORDER BY rp.created_at DESC`,
    [req.valid.query.status]
  );
  return res.status(200).json({
    reports: rows.map((r) => ({ ...r, reporter: displayName(r.reporter_name) }))
  });
}));

router.post('/reports/:id/resolve', validateBody(resolveSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    `UPDATE reports SET status = $2, reviewed_by = $3, reviewed_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, req.valid.body.status, req.user.id]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  return res.status(200).json({ report: rows[0] });
}));

router.post('/listings/:id/hide', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    "UPDATE listings SET status = 'REMOVED' WHERE id = $1 RETURNING id, landlord_id",
    [id]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  await notify(pool, rows[0].landlord_id, 'LISTING_HIDDEN', 'Listing hidden', 'A listing was hidden by an administrator.', null);
  return res.status(200).json({ listing: rows[0] });
}));

module.exports = router;
