const express = require('express');
const pool = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { asyncHandler, idParam, httpError } = require('../utils');

const router = express.Router();

router.get('/', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.title, l.campus, l.street_landmark, l.distance_to_campus_km,
            l.rent_per_month_zmw, l.deposit_zmw, l.occupancy, l.room_type, l.status,
            (SELECT p.url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.sort_order, p.id LIMIT 1) AS cover_photo_url,
            (SELECT COUNT(*)::int FROM requests r WHERE r.listing_id = l.id AND r.status = 'ACCEPTED') AS occupied_beds,
            json_build_object('id', u.id, 'name', u.full_name, 'verified', u.landlord_verified) AS landlord
       FROM saved_listings s
       JOIN listings l ON l.id = s.listing_id
       JOIN users u ON u.id = l.landlord_id
      WHERE s.user_id = $1 AND l.status <> 'REMOVED'
      ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  return res.status(200).json({ listings: rows });
}));

router.post('/:listing_id', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const listingId = idParam(req.params.listing_id);
  const { rows } = await pool.query(
    "SELECT id FROM listings WHERE id = $1 AND status IN ('ACTIVE','FULL') AND EXISTS (SELECT 1 FROM users u WHERE u.id = listings.landlord_id AND u.account_status = 'ACTIVE')",
    [listingId]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  await pool.query(
    'INSERT INTO saved_listings (user_id, listing_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
    [req.user.id, listingId]
  );
  return res.status(201).json({ saved: true });
}));

router.delete('/:listing_id', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const listingId = idParam(req.params.listing_id);
  await pool.query('DELETE FROM saved_listings WHERE user_id = $1 AND listing_id = $2', [req.user.id, listingId]);
  return res.status(204).end();
}));

module.exports = router;
