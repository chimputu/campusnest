const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const pool = require('../config/db');
const { asyncHandler, idParam } = require('../utils');
const { displayName } = require('../lib/helpers');

const router = express.Router();

const receiptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.DISABLE_RATE_LIMIT,
  message: { error: 'rate_limited' }
});

router.get('/:code', receiptLimiter, asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!/^CN-[0-9]{4}-[0-9]+-[A-Z0-9]+$/.test(code)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const { rows } = await pool.query(
    `SELECT r.reference_code, u.full_name AS tenant_name, l.title AS listing_title,
            z.name AS zone_name, l.rent_per_month_zmw, l.deposit_zmw,
            r.move_in_date, r.accepted_at
       FROM requests r
       JOIN users u ON u.id = r.tenant_id
       JOIN listings l ON l.id = r.listing_id
       JOIN zones z ON z.id = l.zone_id
      WHERE r.reference_code = $1 AND r.status IN ('ACCEPTED','COMPLETED')`,
    [code]
  );
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const row = rows[0];
  return res.status(200).json({
    reference_code: row.reference_code,
    tenant_name: displayName(row.tenant_name),
    listing_title: row.listing_title,
    zone_name: row.zone_name,
    rent_per_month_zmw: row.rent_per_month_zmw,
    deposit_zmw: row.deposit_zmw,
    move_in_date: row.move_in_date,
    accepted_at: row.accepted_at
  });
}));

module.exports = router;
