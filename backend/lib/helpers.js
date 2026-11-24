const pool = require('../config/db');

function safeUser(row) {
  const { password_hash, ...rest } = row;
  return rest;
}

function displayName(full_name) {
  const parts = String(full_name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

async function notify(client, userId, type, title, body, linkPath) {
  const queryClient = client || pool;
  await queryClient.query(
    `INSERT INTO notifications (user_id, type, title, body, link_path, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, type, title, body || null, linkPath || null]
  );
}

module.exports = { safeUser, displayName, notify };
