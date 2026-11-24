const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');

let bcrypt;
try { bcrypt = require('bcrypt'); } catch (_) { bcrypt = require('bcryptjs'); }

const pool = require('../config/db');
const { safeUser } = require('../lib/helpers');
const { signSession, setSessionCookie, clearSessionCookie, requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler, isUnique } = require('../utils');

const router = express.Router();

const DUMMY_HASH = bcrypt.hashSync('__campusnest_dummy__' + Math.random().toString(36), 12);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' }
});

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  phone: z.string().trim().min(1).max(40),
  role: z.enum(['TENANT', 'LANDLORD']),
  student_id: z.string().trim().max(60).optional(),
  registration_number: z.string().trim().max(60).optional()
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

router.post('/register', authLimiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
  const b = req.valid.body;
  const email = b.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(b.password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (
         full_name, email, password_hash, phone, role, student_id, registration_number,
         account_status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NOW(), NOW())
       RETURNING *`,
      [b.full_name, email, passwordHash, b.phone, b.role, b.student_id || null, b.registration_number || null]
    );
    const user = rows[0];
    setSessionCookie(res, signSession(user));
    return res.status(201).json({ user: safeUser(user) });
  } catch (err) {
    if (isUnique(err, 'users_email_lower_uniq')) {
      return res.status(409).json({ error: 'email_taken' });
    }
    throw err;
  }
}));

router.post('/login', authLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  const b = req.valid.body;
  const email = b.email.trim().toLowerCase();
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
  const user = rows[0];
  const matches = await bcrypt.compare(b.password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !matches) return res.status(401).json({ error: 'invalid_credentials' });
  if (user.account_status === 'SUSPENDED') return res.status(403).json({ error: 'suspended' });
  setSessionCookie(res, signSession(user));
  return res.status(200).json({ user: safeUser(user) });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({ user: safeUser(req.user) });
});

module.exports = router;
