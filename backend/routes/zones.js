const express = require('express');
const pool = require('../config/db');
const { asyncHandler } = require('../utils');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, campus, name, approx_distance_min_km, approx_distance_max_km, display_order
       FROM zones WHERE is_active = TRUE ORDER BY campus, display_order`
  );
  const grouped = { MAIN: [], TOWN: [] };
  for (const row of rows) {
    if (grouped[row.campus]) grouped[row.campus].push(row);
  }
  return res.status(200).json(grouped);
}));

module.exports = router;
