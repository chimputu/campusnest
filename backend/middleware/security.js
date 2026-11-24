const env = require('../config/env');

function checkOrigin(req, res, next) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let allowed = env.CLIENT_ORIGIN;
  try { allowed = new URL(env.CLIENT_ORIGIN).origin; } catch (_) { /* use raw value */ }
  if (origin !== allowed) return res.status(403).json({ error: 'forbidden' });
  return next();
}

module.exports = { checkOrigin };
