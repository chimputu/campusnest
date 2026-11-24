const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, idParam, httpError } = require('../utils');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows: unread } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id]
  );
  const { rows } = await pool.query(
    `SELECT id, type, title, body, link_path, read_at, created_at
       FROM notifications WHERE user_id = $1
      ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT 50`,
    [req.user.id]
  );
  return res.status(200).json({ notifications: rows, unread_count: unread[0].n });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  return res.status(204).end();
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, req.user.id]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  return res.status(200).json({ notification: rows[0] });
}));

module.exports = router;
