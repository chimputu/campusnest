const jwt = require('jsonwebtoken');
const env = require('../config/env');
const pool = require('../config/db');

const COOKIE_NAME = 'cn_session';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function signSession(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '7d' });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: MAX_AGE
  };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

async function loadUser(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0];
}

function readToken(req) {
  return req.cookies && req.cookies[COOKIE_NAME];
}

async function optionalAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return next();
    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = await loadUser(payload.sub);
    if (user && user.account_status !== 'SUSPENDED') req.user = user;
    return next();
  } catch (_) {
    return next();
  }
}

async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  try {
    const user = await loadUser(payload.sub);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    if (user.account_status === 'SUSPENDED') return res.status(403).json({ error: 'suspended' });
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

const requireRole = (...roles) => (req, res, next) =>
  requireAuth(req, res, () => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    return next();
  });

module.exports = {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  optionalAuth,
  requireAuth,
  requireRole
};
